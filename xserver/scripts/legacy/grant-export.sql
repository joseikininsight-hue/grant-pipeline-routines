SELECT
  p.ID,
  p.post_title,
  p.post_name,
  p.post_date,
  p.post_status,
  MAX(CASE WHEN pm.meta_key='max_amount_numeric' THEN pm.meta_value END) AS max_amount,
  MAX(CASE WHEN pm.meta_key='deadline_date' THEN pm.meta_value END) AS deadline_date,
  MAX(CASE WHEN pm.meta_key='organization' THEN pm.meta_value END) AS organization,
  MAX(CASE WHEN pm.meta_key='organization_type' THEN pm.meta_value END) AS org_type,
  MAX(CASE WHEN pm.meta_key='application_status' THEN pm.meta_value END) AS app_status,
  MAX(CASE WHEN pm.meta_key='adoption_rate' THEN pm.meta_value END) AS adoption_rate,
  MAX(CASE WHEN pm.meta_key='difficulty_level' THEN pm.meta_value END) AS difficulty,
  MAX(CASE WHEN pm.meta_key='_gi_pv_total' THEN pm.meta_value END) AS gi_pv_total,
  MAX(CASE WHEN pm.meta_key='_gi_last_access' THEN pm.meta_value END) AS gi_last_access,
  MAX(CASE WHEN pm.meta_key='views_count' THEN pm.meta_value END) AS views_count
FROM wp_posts p
LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
WHERE p.post_type='grant' AND p.post_status='publish'
GROUP BY p.ID;
