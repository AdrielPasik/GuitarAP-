-- Atomic owner-scoped replication. Every writer locks sync_cursors(owner_id), so
-- change cursors are commit ordered and independent from device clocks.
create or replace function public.sync_library(p_owner_id uuid, p_op_id uuid, p_snapshot jsonb)
returns jsonb language plpgsql security invoker as $$
declare cached jsonb; item jsonb; current_node public.library_nodes; current_document public.documents; changed boolean; cursor_value bigint;
  result jsonb := jsonb_build_object('documents','[]'::jsonb,'nodes','[]'::jsonb,'versions','[]'::jsonb,'conflicts','[]'::jsonb);
begin
  if auth.uid() is null or auth.uid() <> p_owner_id then raise exception 'owner mismatch'; end if;
  select result into cached from public.sync_operations where owner_id=auth.uid() and op_id=p_op_id;
  if cached is not null then return cached; end if;
  insert into public.sync_cursors(owner_id) values(auth.uid()) on conflict do nothing;
  perform 1 from public.sync_cursors where owner_id=auth.uid() for update;
  for item in select * from jsonb_array_elements(coalesce(p_snapshot->'nodes','[]')) loop
    select * into current_node from public.library_nodes where id=(item->>'id')::uuid and owner_id=auth.uid() for update;
    changed := current_node is null or current_node.rev = (item->>'rev')::bigint - 1;
    if changed then
      insert into public.library_nodes(id,owner_id,parent_id,kind,name,sort_order,song,rev,deleted_at,created_at,updated_at) values((item->>'id')::uuid,auth.uid(),nullif(item->>'parentId','')::uuid,item->>'kind',item->>'name',(item->>'order')::bigint,item->'song',(item->>'rev')::bigint,case when item->>'deletedAt' is null then null else to_timestamp((item->>'deletedAt')::double precision/1000) end,to_timestamp((item->>'createdAt')::double precision/1000),to_timestamp((item->>'updatedAt')::double precision/1000)) on conflict(id) do update set parent_id=excluded.parent_id,name=excluded.name,sort_order=excluded.sort_order,song=excluded.song,rev=excluded.rev,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at where library_nodes.owner_id=auth.uid() and library_nodes.rev=excluded.rev-1;
      update public.sync_cursors set value=value+1 where owner_id=auth.uid() returning value into cursor_value;
      insert into public.sync_changes values(auth.uid(),cursor_value,'node',item||jsonb_build_object('ownerId',auth.uid(),'lastOpId',p_op_id));
      result:=jsonb_set(result,'{nodes}',(result->'nodes')||jsonb_build_array(item||jsonb_build_object('ownerId',auth.uid(),'lastOpId',p_op_id)));
    else result:=jsonb_set(result,'{conflicts}',(result->'conflicts')||jsonb_build_array(to_jsonb(current_node)||jsonb_build_object('ownerId',auth.uid(),'lastOpId',p_op_id))); end if;
  end loop;
  for item in select * from jsonb_array_elements(coalesce(p_snapshot->'documents','[]')) loop
    select * into current_document from public.documents where id=(item->>'id')::uuid and owner_id=auth.uid() for update;
    changed := current_document is null or current_document.rev = (item->>'rev')::bigint - 1;
    if changed then
      insert into public.documents(id,owner_id,node_id,song_id,type,title,payload,rev,deleted_at,created_at,updated_at) values((item->>'id')::uuid,auth.uid(),nullif(item->>'nodeId','')::uuid,nullif(item->>'songId','')::uuid,item->>'type',item->>'title',item->'content',(item->>'rev')::bigint,case when item->>'deletedAt' is null then null else to_timestamp((item->>'deletedAt')::double precision/1000) end,to_timestamp((item->>'createdAt')::double precision/1000),to_timestamp((item->>'updatedAt')::double precision/1000)) on conflict(id) do update set node_id=excluded.node_id,song_id=excluded.song_id,title=excluded.title,payload=excluded.payload,rev=excluded.rev,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at where documents.owner_id=auth.uid() and documents.rev=excluded.rev-1;
      update public.sync_cursors set value=value+1 where owner_id=auth.uid() returning value into cursor_value;
      insert into public.sync_changes values(auth.uid(),cursor_value,'document',item||jsonb_build_object('ownerId',auth.uid(),'lastOpId',p_op_id));
      result:=jsonb_set(result,'{documents}',(result->'documents')||jsonb_build_array(item||jsonb_build_object('ownerId',auth.uid(),'lastOpId',p_op_id)));
    else result:=jsonb_set(result,'{conflicts}',(result->'conflicts')||jsonb_build_array(to_jsonb(current_document)||jsonb_build_object('content',current_document.payload,'ownerId',auth.uid(),'lastOpId',p_op_id))); end if;
  end loop;
  for item in select * from jsonb_array_elements(coalesce(p_snapshot->'versions','[]')) loop
    insert into public.document_versions(id,owner_id,document_id,reason,title,payload,created_at) values((item->>'id')::uuid,auth.uid(),(item->>'documentId')::uuid,item->>'reason',item->>'title',item->'content',to_timestamp((item->>'createdAt')::double precision/1000)) on conflict(id) do nothing;
    if found then update public.sync_cursors set value=value+1 where owner_id=auth.uid() returning value into cursor_value; insert into public.sync_changes values(auth.uid(),cursor_value,'version',item||jsonb_build_object('ownerId',auth.uid(),'lastOpId',p_op_id)); end if;
    result:=jsonb_set(result,'{versions}',(result->'versions')||jsonb_build_array(item||jsonb_build_object('ownerId',auth.uid(),'lastOpId',p_op_id)));
  end loop;
  insert into public.sync_operations(owner_id,op_id,result) values(auth.uid(),p_op_id,result); return result;
end $$;

create or replace function public.pull_library(p_owner_id uuid, p_after text, p_limit int default 100)
returns jsonb language plpgsql security invoker as $$
declare page jsonb; last_cursor bigint; more boolean;
begin
  if auth.uid() is null or auth.uid() <> p_owner_id then raise exception 'owner mismatch'; end if;
  with selected as (select cursor,kind,record from public.sync_changes where owner_id=auth.uid() and cursor>p_after::bigint order by cursor limit greatest(1,least(p_limit,500)))
  select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'record',record) order by cursor),'[]'), coalesce(max(cursor),p_after::bigint) into page,last_cursor from selected;
  select exists(select 1 from public.sync_changes where owner_id=auth.uid() and cursor>last_cursor) into more;
  return jsonb_build_object('cursor',last_cursor::text,'changes',page,'hasMore',more);
end $$;
