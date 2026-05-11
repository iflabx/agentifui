-- Migration: Optimize notification queries for performance
-- Created: 2025-09-10
-- Purpose: Add database function for efficient unread count by category

-- Function to get unread notification counts by category for a user
CREATE OR REPLACE FUNCTION get_user_unread_count_by_category(user_uuid uuid)
RETURNS TABLE(
  category text,
  count bigint
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
    COALESCE(n.category, 'uncategorized') as category,
    COUNT(*) as count
  FROM public.notifications n
  LEFT JOIN public.notification_reads nr ON n.id = nr.notification_id AND nr.user_id = effective_user_id
  WHERE 
    n.published = true
    AND nr.id IS NULL  -- Not read yet
    AND (
      -- Public notifications (no specific targeting)
      (n.target_roles = '{}' AND n.target_users = '{}') OR
      -- Role-based targeting (user_role[] aligns with profiles.role enum)
      (n.target_roles && ARRAY[(SELECT role FROM public.profiles WHERE id = effective_user_id)]) OR
      -- User-specific targeting  
      (effective_user_id = ANY(n.target_users))
    )
  GROUP BY COALESCE(n.category, 'uncategorized')
  ORDER BY category;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment for documentation
COMMENT ON FUNCTION get_user_unread_count_by_category(uuid) IS 
'Get unread notification counts grouped by category for a specific user. Uses efficient LEFT JOIN and proper targeting logic for large datasets.';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_user_unread_count_by_category(uuid) TO authenticated;
