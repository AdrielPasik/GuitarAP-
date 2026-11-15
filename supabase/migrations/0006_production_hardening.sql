-- Production hardening for projects that already applied 0001 through 0005.
-- This migration is additive: it does not update or delete stored library data.

-- Legacy RPCs bypass the cursor/change-log protocol used by current clients.
revoke execute on function public.update_document(uuid, bigint, jsonb, text) from public, anon, authenticated;
revoke execute on function public.sync_documents(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.pull_documents(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.sync_library(p_owner_id uuid, p_op_id uuid, p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cached jsonb;
  item jsonb;
  current_node public.library_nodes;
  current_document public.documents;
  current_version public.document_versions;
  incoming_rev bigint;
  parent_id uuid;
  node_id uuid;
  song_id uuid;
  cursor_value bigint;
  result jsonb := jsonb_build_object(
    'documents', '[]'::jsonb,
    'nodes', '[]'::jsonb,
    'versions', '[]'::jsonb,
    'conflicts', '[]'::jsonb
  );
begin
  if auth.uid() is null or auth.uid() <> p_owner_id then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  insert into public.sync_cursors(owner_id) values(auth.uid()) on conflict do nothing;
  perform 1 from public.sync_cursors where owner_id = auth.uid() for update;

  -- Recheck only after taking the per-owner lock. Two concurrent retries of the
  -- same operation can therefore never apply the snapshot twice.
  select so.result into cached
  from public.sync_operations so
  where so.owner_id = auth.uid() and so.op_id = p_op_id;
  if cached is not null then return cached; end if;

  for item in select * from jsonb_array_elements(coalesce(p_snapshot->'nodes', '[]'::jsonb)) loop
    incoming_rev := coalesce((item->>'rev')::bigint, 1);
    parent_id := nullif(item->>'parentId', '')::uuid;
    current_node := null;
    select n.* into current_node from public.library_nodes n where n.id = (item->>'id')::uuid for update;

    if current_node is not null and current_node.owner_id <> auth.uid() then
      raise exception 'node id belongs to another account' using errcode = '42501';
    end if;
    if parent_id is not null and not exists (
      select 1 from public.library_nodes p where p.id = parent_id and p.owner_id = auth.uid()
    ) then
      raise exception 'node parent does not exist in this account' using errcode = '23503';
    end if;

    if current_node is null or current_node.rev = incoming_rev - 1 then
      insert into public.library_nodes(
        id, owner_id, parent_id, kind, name, sort_order, song, rev,
        deleted_at, created_at, updated_at
      ) values (
        (item->>'id')::uuid, auth.uid(), parent_id, item->>'kind', item->>'name',
        (item->>'order')::bigint, item->'song', incoming_rev,
        case when item->>'deletedAt' is null then null else to_timestamp((item->>'deletedAt')::double precision / 1000) end,
        to_timestamp((item->>'createdAt')::double precision / 1000),
        to_timestamp((item->>'updatedAt')::double precision / 1000)
      )
      on conflict(id) do update set
        parent_id = excluded.parent_id,
        kind = excluded.kind,
        name = excluded.name,
        sort_order = excluded.sort_order,
        song = excluded.song,
        rev = excluded.rev,
        deleted_at = excluded.deleted_at,
        updated_at = excluded.updated_at
      where public.library_nodes.owner_id = auth.uid()
        and public.library_nodes.rev = excluded.rev - 1
      returning * into current_node;

      if current_node is null then
        raise exception 'node revision changed concurrently' using errcode = '40001';
      end if;
      update public.sync_cursors set value = value + 1 where owner_id = auth.uid() returning value into cursor_value;
      insert into public.sync_changes(owner_id, cursor, kind, record)
      values(auth.uid(), cursor_value, 'node', item || jsonb_build_object('ownerId', auth.uid(), 'lastOpId', p_op_id));
      result := jsonb_set(result, '{nodes}', (result->'nodes') || jsonb_build_array(item || jsonb_build_object('ownerId', auth.uid(), 'lastOpId', p_op_id)));
    else
      result := jsonb_set(result, '{conflicts}', (result->'conflicts') || jsonb_build_array(jsonb_build_object(
        'id', current_node.id,
        'parentId', current_node.parent_id,
        'kind', current_node.kind,
        'name', current_node.name,
        'order', current_node.sort_order,
        'song', current_node.song,
        'rev', current_node.rev,
        'deletedAt', case when current_node.deleted_at is null then null else extract(epoch from current_node.deleted_at) * 1000 end,
        'createdAt', extract(epoch from current_node.created_at) * 1000,
        'updatedAt', extract(epoch from current_node.updated_at) * 1000,
        'ownerId', current_node.owner_id,
        'lastOpId', p_op_id
      )));
    end if;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_snapshot->'documents', '[]'::jsonb)) loop
    incoming_rev := (item->>'rev')::bigint;
    node_id := nullif(item->>'nodeId', '')::uuid;
    song_id := nullif(item->>'songId', '')::uuid;
    current_document := null;
    select d.* into current_document from public.documents d where d.id = (item->>'id')::uuid for update;

    if current_document is not null and current_document.owner_id <> auth.uid() then
      raise exception 'document id belongs to another account' using errcode = '42501';
    end if;
    if node_id is not null and not exists (
      select 1 from public.library_nodes n where n.id = node_id and n.owner_id = auth.uid()
    ) then
      raise exception 'document folder does not exist in this account' using errcode = '23503';
    end if;
    if song_id is not null and not exists (
      select 1 from public.library_nodes n where n.id = song_id and n.owner_id = auth.uid() and n.kind = 'song'
    ) then
      raise exception 'document song does not exist in this account' using errcode = '23503';
    end if;

    if current_document is null or current_document.rev = incoming_rev - 1 then
      insert into public.documents(
        id, owner_id, node_id, song_id, type, title, payload, rev,
        deleted_at, created_at, updated_at
      ) values (
        (item->>'id')::uuid, auth.uid(), node_id, song_id, item->>'type', item->>'title',
        item->'content', incoming_rev,
        case when item->>'deletedAt' is null then null else to_timestamp((item->>'deletedAt')::double precision / 1000) end,
        to_timestamp((item->>'createdAt')::double precision / 1000),
        to_timestamp((item->>'updatedAt')::double precision / 1000)
      )
      on conflict(id) do update set
        node_id = excluded.node_id,
        song_id = excluded.song_id,
        type = excluded.type,
        title = excluded.title,
        payload = excluded.payload,
        rev = excluded.rev,
        deleted_at = excluded.deleted_at,
        updated_at = excluded.updated_at
      where public.documents.owner_id = auth.uid()
        and public.documents.rev = excluded.rev - 1
      returning * into current_document;

      if current_document is null then
        raise exception 'document revision changed concurrently' using errcode = '40001';
      end if;
      update public.sync_cursors set value = value + 1 where owner_id = auth.uid() returning value into cursor_value;
      insert into public.sync_changes(owner_id, cursor, kind, record)
      values(auth.uid(), cursor_value, 'document', item || jsonb_build_object('ownerId', auth.uid(), 'lastOpId', p_op_id));
      result := jsonb_set(result, '{documents}', (result->'documents') || jsonb_build_array(item || jsonb_build_object('ownerId', auth.uid(), 'lastOpId', p_op_id)));
    else
      result := jsonb_set(result, '{conflicts}', (result->'conflicts') || jsonb_build_array(jsonb_build_object(
        'id', current_document.id,
        'nodeId', current_document.node_id,
        'songId', current_document.song_id,
        'type', current_document.type,
        'title', current_document.title,
        'content', current_document.payload,
        'rev', current_document.rev,
        'deletedAt', case when current_document.deleted_at is null then null else extract(epoch from current_document.deleted_at) * 1000 end,
        'createdAt', extract(epoch from current_document.created_at) * 1000,
        'updatedAt', extract(epoch from current_document.updated_at) * 1000,
        'ownerId', current_document.owner_id,
        'lastOpId', p_op_id
      )));
    end if;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_snapshot->'versions', '[]'::jsonb)) loop
    current_version := null;
    select v.* into current_version from public.document_versions v where v.id = (item->>'id')::uuid;
    if current_version is not null and current_version.owner_id <> auth.uid() then
      raise exception 'version id belongs to another account' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.documents d where d.id = (item->>'documentId')::uuid and d.owner_id = auth.uid()
    ) then
      raise exception 'version document does not exist in this account' using errcode = '23503';
    end if;

    if current_version is null then
      insert into public.document_versions(id, owner_id, document_id, reason, title, payload, created_at)
      values(
        (item->>'id')::uuid, auth.uid(), (item->>'documentId')::uuid,
        item->>'reason', item->>'title', item->'content',
        to_timestamp((item->>'createdAt')::double precision / 1000)
      ) returning * into current_version;
      update public.sync_cursors set value = value + 1 where owner_id = auth.uid() returning value into cursor_value;
      insert into public.sync_changes(owner_id, cursor, kind, record)
      values(auth.uid(), cursor_value, 'version', item || jsonb_build_object('ownerId', auth.uid(), 'lastOpId', p_op_id));
    end if;
    result := jsonb_set(result, '{versions}', (result->'versions') || jsonb_build_array(jsonb_build_object(
      'id', current_version.id,
      'documentId', current_version.document_id,
      'reason', current_version.reason,
      'title', current_version.title,
      'content', current_version.payload,
      'createdAt', extract(epoch from current_version.created_at) * 1000,
      'ownerId', current_version.owner_id,
      'lastOpId', p_op_id
    )));
  end loop;

  insert into public.sync_operations(owner_id, op_id, result) values(auth.uid(), p_op_id, result);
  return result;
end
$$;

create or replace function public.pull_library(p_owner_id uuid, p_after text, p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  page jsonb;
  last_cursor bigint;
  more boolean;
begin
  if auth.uid() is null or auth.uid() <> p_owner_id then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;
  with selected as (
    select cursor, kind, record
    from public.sync_changes
    where owner_id = auth.uid() and cursor > p_after::bigint
    order by cursor
    limit greatest(1, least(p_limit, 500))
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'record', record) order by cursor), '[]'::jsonb),
    coalesce(max(cursor), p_after::bigint)
  into page, last_cursor
  from selected;
  select exists(
    select 1 from public.sync_changes where owner_id = auth.uid() and cursor > last_cursor
  ) into more;
  return jsonb_build_object('cursor', last_cursor::text, 'changes', page, 'hasMore', more);
end
$$;

revoke execute on function public.sync_library(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.pull_library(uuid, text, int) from public, anon;
grant execute on function public.sync_library(uuid, uuid, jsonb) to authenticated;
grant execute on function public.pull_library(uuid, text, int) to authenticated;

-- Current clients write only through the atomic RPC. Direct DML could bypass
-- the change log, so authenticated browsers receive read-only table access.
revoke insert, update, delete on public.documents, public.library_nodes, public.document_versions from anon, authenticated;
revoke all on public.sync_operations, public.sync_cursors, public.sync_changes from anon, authenticated;
grant select on public.documents, public.library_nodes, public.document_versions to authenticated;
