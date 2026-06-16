import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const UUID_KEY = 'pixelpop_uuid'

function getOrCreateUuid() {
  let id = localStorage.getItem(UUID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(UUID_KEY, id)
  }
  return id
}

/**
 * Anonymous identity: a UUID persisted in localStorage, mirrored into a
 * Supabase `profiles` row. No signup, no auth.
 */
export function useUser() {
  const [uuid] = useState(getOrCreateUuid)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('ensure_profile', {
      p_id: uuid,
      p_name: null,
    })
    if (!error && data) setProfile(data)
    setLoading(false)
  }, [uuid])

  useEffect(() => {
    refresh()
  }, [refresh])

  const setDisplayName = useCallback(
    async (name) => {
      const { data, error } = await supabase.rpc('ensure_profile', {
        p_id: uuid,
        p_name: name,
      })
      if (!error && data) setProfile(data)
      return { error }
    },
    [uuid]
  )

  return { uuid, profile, setProfile, loading, refresh, setDisplayName }
}
