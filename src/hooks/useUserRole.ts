import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AppRole = "admin" | "curador";

interface UseUserRoleReturn {
  roles: AppRole[];
  isAdmin: boolean;
  isCurador: boolean;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useUserRole(): UseUserRoleReturn {
  const { user } = useAuth();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user) {
      setRoles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (!error && data) {
      setRoles(data.map((r) => r.role as AppRole));
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return {
    roles,
    isAdmin: roles.includes("admin"),
    isCurador: roles.includes("curador") || roles.includes("admin"),
    loading,
    reload: load,
  };
}
