import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type {
  ApiEmail,
  Paginated,
  ScheduleRequest,
  ScheduleResponse,
} from "@reachinbox/shared";

interface ListParams {
  page: number;
  pageSize?: number;
  search?: string;
}

async function fetchList(path: string, params: ListParams): Promise<Paginated<ApiEmail>> {
  const res = await api.get<{ data: Paginated<ApiEmail> }>(path, {
    params: { page: params.page, pageSize: params.pageSize ?? 10, search: params.search || undefined },
  });
  return res.data.data;
}

export function useScheduledEmails(params: ListParams) {
  return useQuery({
    queryKey: ["emails", "scheduled", params],
    queryFn: () => fetchList("/emails/scheduled", params),
    placeholderData: (prev) => prev,
  });
}

export function useSentEmails(params: ListParams & { status?: string }) {
  return useQuery({
    queryKey: ["emails", "sent", params],
    queryFn: () =>
      fetchList(`/emails/sent${params.status ? `?status=${params.status}` : ""}`, params),
    placeholderData: (prev) => prev,
  });
}

export function useSearchEmails(params: ListParams) {
  return useQuery({
    queryKey: ["emails", "search", params],
    queryFn: async () => {
      const res = await api.get<{ data: Paginated<ApiEmail> }>("/emails/search", {
        params: {
          q: params.search,
          page: params.page,
          pageSize: params.pageSize ?? 10,
        },
      });
      return res.data.data;
    },
    enabled: Boolean(params.search),
    placeholderData: (prev) => prev,
  });
}

export function useScheduleEmails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ScheduleRequest) => {
      const res = await api.post<{ data: ScheduleResponse }>(
        "/emails/schedule",
        payload,
      );
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["emails"] });
    },
  });
}
