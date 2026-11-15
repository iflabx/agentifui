SET search_path = public;

ALTER TABLE backend_conversations
  DROP CONSTRAINT backend_conversations_backend_type_check,
  ADD CONSTRAINT backend_conversations_backend_type_check
    CHECK (backend_type IN ('langchain', 'dify'));
