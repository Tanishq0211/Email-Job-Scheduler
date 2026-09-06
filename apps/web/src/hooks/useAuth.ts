import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ApiUser, ApiSender, ApiSlackStatus } from "@reachinbox/shared";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await api.get<{ data: { user: ApiUser } }>("/auth/me");
      return res.data.data.user;
    },
    retry: false,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post("/auth/logout");
    },
    onSuccess: () => {
      qc.clear();
      window.location.href = "/login";
    },
  });
}

export function useSenders() {
  return useQuery({
    queryKey: ["senders"],
    queryFn: async () => {
      const res = await api.get<{ data: { senders: ApiSender[] } }>("/senders");
      return res.data.data.senders;
    },
  });
}

export function useSlackStatus() {
  return useQuery({
    queryKey: ["slack-status"],
    queryFn: async () => {
      const res = await api.get<{ data: ApiSlackStatus }>("/slack/status");
      return res.data.data;
    },
  });
}

export function useSlackDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post("/slack/disconnect");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["slack-status"] }),
  });
}
