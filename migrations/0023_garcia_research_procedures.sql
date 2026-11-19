-- Preserve a distilled, independently validated procedure with each research event.
ALTER TABLE garcia_research_events
  ADD COLUMN reusable_procedure TEXT;
