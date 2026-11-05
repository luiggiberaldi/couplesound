-- SyncWave — esquema de Supabase (Postgres)
-- Ejecuta este archivo completo en el SQL Editor del proyecto de Supabase.
-- Implementa las reglas de docs/prompt-syncwave-supabase.md; aquí no se
-- repiten las notas de diseño, solo lo que afecta al SQL.
create table if not exists public.rooms (
  code           text primary key,
  media          jsonb,
  position       double precision not null default 0,
  is_playing     boolean not null default false,
  sent_at_global bigint,
  host_id        text not null,
  control_mode   text not null default 'free' check (control_mode in ('free', 'host')),
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- Sin políticas y sin privilegios: anon no lee ni escribe la tabla directamente.
-- El código de 6 caracteres sigue siendo el control de acceso, pero solo se ejerce
-- por las RPC de abajo, una llamada por código conocido (no hay listados).
revoke all on table public.rooms from anon, authenticated;

create or replace function public.assert_room_code(p_code text)
returns void language plpgsql immutable as $$
begin
  if p_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'Código de sala inválido' using errcode = '22023';
  end if;
end $$;

create or replace function public.create_room(
  p_code text, p_device_id text, p_control_mode text default 'free'
) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare v_room public.rooms;
begin
  perform public.assert_room_code(p_code);
  if p_device_id is null or length(p_device_id) > 64 then
    raise exception 'deviceId inválido' using errcode = '22023';
  end if;
  if p_control_mode not in ('free', 'host') then
    raise exception 'control_mode inválido' using errcode = '22023';
  end if;
  insert into public.rooms (code, host_id, control_mode)
  values (p_code, p_device_id, p_control_mode)
  returning * into v_room;
  return v_room;
exception when unique_violation then
  raise exception 'Código de sala ocupado' using errcode = 'P0001';
end $$;

create or replace function public.get_room(p_code text)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare v_room public.rooms;
begin
  perform public.assert_room_code(p_code);
  select * into v_room from public.rooms where code = p_code;
  if not found then
    raise exception 'Esa sala no existe o ya se cerró' using errcode = 'P0002';
  end if;
  return v_room;
end $$;

create or replace function public.update_room(
  p_code text,
  p_device_id text,
  p_media jsonb,
  p_position double precision,
  p_is_playing boolean,
  p_sent_at_global bigint
) returns void
language plpgsql security definer set search_path = public as $$
declare v_room public.rooms;
begin
  perform public.assert_room_code(p_code);
  select * into v_room from public.rooms where code = p_code for update;
  if not found then
    raise exception 'Esa sala no existe o ya se cerró' using errcode = 'P0002';
  end if;
  if v_room.control_mode = 'host' and v_room.host_id <> p_device_id then
    raise exception 'Solo el anfitrión controla esta sala' using errcode = '42501';
  end if;
  -- Una posición publicada sin su ancla temporal es inutilizable: se rechaza.
  if p_position is not null and p_sent_at_global is null then
    raise exception 'position requiere sent_at_global' using errcode = '22023';
  end if;
  if p_position is not null and p_position < 0 then
    raise exception 'position negativa' using errcode = '22023';
  end if;
  if p_media is not null then
    if coalesce(p_media->>'kind', '') not in ('file', 'url', 'youtube') then
      raise exception 'media.kind inválido' using errcode = '22023';
    end if;
    if length(coalesce(p_media->>'title', '')) > 300 then
      raise exception 'media.title demasiado largo' using errcode = '22023';
    end if;
    if p_media->>'kind' = 'youtube' then
      if coalesce(p_media->>'src', '') !~ '^[A-Za-z0-9_-]{11}$' then
        raise exception 'media.src debe ser un videoId de YouTube' using errcode = '22023';
      end if;
      if p_media->'mirror' is not null then
        raise exception 'media.mirror solo aplica a kind=file' using errcode = '22023';
      end if;
    elsif p_media->>'kind' = 'url' then
      if coalesce(p_media->>'src', '') !~ '^https?://' or length(p_media->>'src') > 2048 then
        raise exception 'media.src debe ser una URL http(s)' using errcode = '22023';
      end if;
      if p_media->'mirror' is not null then
        raise exception 'media.mirror solo aplica a kind=file' using errcode = '22023';
      end if;
    else
      -- kind = 'file': el src es un blob local de cada dispositivo y nunca se persiste.
      if p_media->>'src' is not null
         or coalesce(p_media->'mirror'->>'name', '') = ''
         or coalesce((p_media->'mirror'->>'size')::bigint, 0) <= 0 then
        raise exception 'media de archivo inválido' using errcode = '22023';
      end if;
    end if;
  end if;
  update public.rooms set
    media = coalesce(p_media, media),
    position = coalesce(p_position, position),
    is_playing = coalesce(p_is_playing, is_playing),
    sent_at_global = coalesce(p_sent_at_global, sent_at_global),
    updated_at = now()
  where code = p_code;
end $$;

create or replace function public.set_control_mode(
  p_code text, p_device_id text, p_mode text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_room_code(p_code);
  if p_mode not in ('free', 'host') then
    raise exception 'control_mode inválido' using errcode = '22023';
  end if;
  update public.rooms set
    control_mode = p_mode,
    host_id = case when p_mode = 'host' then p_device_id else host_id end,
    updated_at = now()
  where code = p_code and (control_mode = 'free' or host_id = p_device_id);
  if not found then
    raise exception 'Solo el anfitrión cambia los permisos' using errcode = '42501';
  end if;
end $$;

create or replace function public.claim_host(p_code text, p_device_id text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_room_code(p_code);
  update public.rooms set host_id = p_device_id, updated_at = now()
  where code = p_code and control_mode = 'host';
  if not found then
    raise exception 'La sala no está en modo anfitrión' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.purge_stale_rooms(p_days integer default 2)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  if p_days is null or p_days < 1 then
    raise exception 'p_days debe ser >= 1' using errcode = '22023';
  end if;
  -- Nunca por created_at: una sala vieja puede estar en uso ahora mismo.
  -- Solo salas con actividad caducada y en pausa: si está reproduciendo, hay oyentes
  -- aunque no haya escrituras recientes (updated_at no se refresca solo por reproducir).
  delete from public.rooms
  where updated_at < now() - make_interval(days => p_days)
    and is_playing = false;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

-- Sin grant: purge_stale_rooms borra filas, así que no se expone a anon.
-- Se ejecuta desde el SQL Editor (rol propietario) o con service_role.

grant execute on function public.create_room(text, text, text) to anon;
grant execute on function public.get_room(text) to anon;
grant execute on function public.update_room(text, text, jsonb, double precision, boolean, bigint) to anon;
grant execute on function public.set_control_mode(text, text, text) to anon;
grant execute on function public.claim_host(text, text) to anon;
