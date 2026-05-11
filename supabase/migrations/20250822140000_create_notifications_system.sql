-- ============================================================================
-- Notification Center Database Schema
-- Create unified notification system with notifications and notification_reads tables
-- ============================================================================

-- Create notifications table for storing all types of notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Notification classification
  type text NOT NULL CHECK (type IN ('changelog', 'message')),
  category text,
  
  -- Content fields
  title text NOT NULL,
  content text NOT NULL,
  
  -- Priority and targeting
  priority text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  -- Use user_role[] to align with profiles.role enum and allow array operators
  target_roles user_role[] DEFAULT '{}'::user_role[],
  target_users uuid[] DEFAULT '{}',
  
  -- Publishing control
  published boolean DEFAULT false,
  published_at timestamptz,
  
  -- Audit fields
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now(),
  
  -- Extension field for additional metadata
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Create notification_reads table for tracking user read status
CREATE TABLE IF NOT EXISTS public.notification_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz DEFAULT now(),
  
  -- Ensure one read record per user per notification
  UNIQUE(notification_id, user_id)
);

-- ============================================================================
-- Indexes for performance optimization
-- ============================================================================

-- Indexes for notifications table
CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_category ON public.notifications(category);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON public.notifications(priority);
CREATE INDEX IF NOT EXISTS idx_notifications_published ON public.notifications(published);
CREATE INDEX IF NOT EXISTS idx_notifications_published_at ON public.notifications(published_at DESC) WHERE published = true;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_target_roles ON public.notifications USING GIN(target_roles);
CREATE INDEX IF NOT EXISTS idx_notifications_target_users ON public.notifications USING GIN(target_users);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_notifications_type_published_created ON public.notifications(type, published, created_at DESC) WHERE published = true;

-- Indexes for notification_reads table
CREATE INDEX IF NOT EXISTS idx_notification_reads_user_id ON public.notification_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_notification_id ON public.notification_reads(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_read_at ON public.notification_reads(read_at DESC);

-- ============================================================================
-- Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS on both tables
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

-- Notifications table policies
-- Users can read published notifications that target them
CREATE POLICY "Users can read targeted published notifications" ON public.notifications
FOR SELECT USING (
  published = true AND (
    -- Public notifications (no specific targeting)
    (target_roles = '{}' AND target_users = '{}') OR
    -- Role-based targeting
    (target_roles && ARRAY[(SELECT role FROM public.profiles WHERE id = auth.uid())]) OR
    -- User-specific targeting  
    (auth.uid() = ANY(target_users))
  )
);

-- Admins can manage all notifications
CREATE POLICY "Admins can manage all notifications" ON public.notifications
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- Users with manager role can create notifications
CREATE POLICY "Managers can create notifications" ON public.notifications
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('admin', 'manager')
  )
);

-- Notification reads policies
-- Users can only read their own read status
CREATE POLICY "Users can read own notification reads" ON public.notification_reads
FOR SELECT USING (user_id = auth.uid());

-- Users can mark notifications as read for themselves
CREATE POLICY "Users can mark notifications as read" ON public.notification_reads
FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can update their own read status
CREATE POLICY "Users can update own read status" ON public.notification_reads
FOR UPDATE USING (user_id = auth.uid());

-- Admins can view all read status for management purposes
CREATE POLICY "Admins can view all notification reads" ON public.notification_reads
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- ============================================================================
-- Triggers and Functions
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at for notifications
CREATE TRIGGER update_notifications_updated_at 
    BEFORE UPDATE ON public.notifications 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically set published_at when published status changes to true
CREATE OR REPLACE FUNCTION set_published_at()
RETURNS TRIGGER AS $$
BEGIN
    -- If published status is changing from false to true, set published_at
    IF (OLD.published = false OR OLD.published IS NULL) AND NEW.published = true THEN
        NEW.published_at = now();
    END IF;
    
    -- If published status is changing from true to false, clear published_at
    IF OLD.published = true AND NEW.published = false THEN
        NEW.published_at = NULL;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically manage published_at
CREATE TRIGGER set_notifications_published_at
    BEFORE UPDATE ON public.notifications 
    FOR EACH ROW 
    EXECUTE FUNCTION set_published_at();

-- ============================================================================
-- Utility Functions
-- ============================================================================

-- Function to get unread count for a user
CREATE OR REPLACE FUNCTION get_user_unread_count(user_uuid uuid, notification_type text DEFAULT NULL)
RETURNS TABLE(
  changelog_count bigint,
  message_count bigint,
  total_count bigint
) AS $$
DECLARE
  current_user_id uuid := auth.uid();
  effective_user_id uuid;
BEGIN
  -- Enforce caller identity even under SECURITY DEFINER
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  effective_user_id := current_user_id;

  RETURN QUERY
  SELECT 
    COALESCE(SUM(CASE WHEN n.type = 'changelog' THEN 1 ELSE 0 END), 0) as changelog_count,
    COALESCE(SUM(CASE WHEN n.type = 'message' THEN 1 ELSE 0 END), 0) as message_count,
    COALESCE(COUNT(*), 0) as total_count
  FROM public.notifications n
  LEFT JOIN public.notification_reads nr ON n.id = nr.notification_id AND nr.user_id = effective_user_id
  WHERE 
    n.published = true
    AND nr.id IS NULL  -- Not read yet
    AND (
      -- Public notifications (no specific targeting)
      (n.target_roles = '{}' AND n.target_users = '{}') OR
      -- Role-based targeting
      (n.target_roles && ARRAY[(SELECT role FROM public.profiles WHERE id = effective_user_id)]) OR
      -- User-specific targeting  
      (effective_user_id = ANY(n.target_users))
    )
    AND (notification_type IS NULL OR n.type = notification_type);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark notifications as read in batch
CREATE OR REPLACE FUNCTION mark_notifications_read(notification_ids uuid[], user_uuid uuid)
RETURNS int AS $$
DECLARE
  inserted_count int;
  current_user_id uuid := auth.uid();
  effective_user_id uuid;
BEGIN
  -- Enforce caller identity even under SECURITY DEFINER
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  effective_user_id := current_user_id;

  INSERT INTO public.notification_reads (notification_id, user_id)
  SELECT unnest(notification_ids), effective_user_id
  ON CONFLICT (notification_id, user_id) DO NOTHING;
  
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE public.notifications IS 'Unified notification system storing both changelog and message notifications';
COMMENT ON TABLE public.notification_reads IS 'Tracks which notifications have been read by which users';

COMMENT ON COLUMN public.notifications.type IS 'Type of notification: changelog or message';
COMMENT ON COLUMN public.notifications.category IS 'Sub-category within the type (e.g., feature, bugfix for changelog; admin_announcement, agent_result for message)';
COMMENT ON COLUMN public.notifications.priority IS 'Priority level affecting display and push behavior';
COMMENT ON COLUMN public.notifications.target_roles IS 'Array of user roles that should receive this notification';
COMMENT ON COLUMN public.notifications.target_users IS 'Array of specific user UUIDs that should receive this notification';
COMMENT ON COLUMN public.notifications.metadata IS 'Additional structured data for extensibility';

-- ============================================================================
-- Enable realtime for live updates
-- ============================================================================

-- Enable realtime subscriptions for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_reads;
