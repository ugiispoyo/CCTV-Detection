import axios, { AxiosError } from "axios";
import type { ApiFailure, ApiSuccess } from "@cctv-ai/shared";

const baseURL = import.meta.env.VITE_API_URL ?? "http://localhost:5005";

export const api = axios.create({ baseURL, timeout: 10_000, headers: { Accept: "application/json" } });

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiFailure>) => {
    const payload = error.response?.data;
    return Promise.reject(new ApiError(payload?.error.code ?? "NETWORK_ERROR", payload?.error.message ?? "Unable to reach the API", error.response?.status));
  },
);

export async function getData<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const response = await api.get<ApiSuccess<T>>(url, { params });
  return response.data.data;
}
