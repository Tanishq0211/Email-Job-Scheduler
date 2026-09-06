import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  timeout: 30_000,
});

/** Extract the human message from our standard error envelope. */
export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: { message?: string } }
      | undefined;
    if (data?.error?.message) return data.error.message;
    if (err.code === "ECONNABORTED") return "Request timed out";
    return err.message;
  }
  return err instanceof Error ? err.message : "Unexpected error";
}
