import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, orpc } from "@/lib/orpc-client";

export const recordingKeys = {
  all: ["recordings"] as const,
  list: () => [...recordingKeys.all, "list"] as const,
};

export const recordingsQueryOptions = () => ({
  ...orpc.recording.list.queryOptions(),
  queryKey: recordingKeys.list(),
});

export const useRecordings = () => useQuery(recordingsQueryOptions());

export const useDeleteRecording = () => {
  const queryClient = useQueryClient();

  return useMutation({
    ...orpc.recording.delete.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recordingKeys.all });
    },
  });
};

/**
 * Mint a short-lived presigned GET for a recording and hand it to the browser.
 * The bucket is private, so the URL only exists for the length of this call.
 */
export const useOpenRecording = () =>
  useMutation({
    mutationFn: async (id: string) => {
      const response = await client.recording.downloadUrl({ id });
      const url = response.data?.downloadUrl;
      if (!url) throw new Error(response.error?.message ?? "No download URL was returned");
      return url;
    },
  });
