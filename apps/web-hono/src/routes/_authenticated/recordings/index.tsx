import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@kaipu/web-ui";
import { Download, Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  recordingsQueryOptions,
  useDeleteRecording,
  useOpenRecording,
  useRecordings,
} from "@/hooks/use-recordings";

export const Route = createFileRoute("/_authenticated/recordings/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(recordingsQueryOptions()),
  component: RecordingsPage,
});

/** Human-readable size; recordings run from a few KB (screenshot) to GBs (video). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function RecordingsPage() {
  const t = useTranslations("recordings");
  const { data: response, isPending, error } = useRecordings();
  const deleteRecording = useDeleteRecording();
  const openRecording = useOpenRecording();

  const recordings = response?.data ?? [];

  const handleOpen = (id: string) => {
    openRecording.mutate(id, {
      onSuccess: (url) => {
        window.open(url, "_blank", "noopener,noreferrer");
      },
      onError: () => toast.error(t("openError")),
    });
  };

  const handleDelete = (id: string) => {
    deleteRecording.mutate(
      { id },
      {
        onSuccess: () => toast.success(t("deleteSuccess")),
        onError: () => toast.error(t("deleteError")),
      },
    );
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
      </div>

      {isPending ? (
        <Card>
          <CardContent className="p-4 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={`skeleton-${i}`} className="h-5 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-destructive">{t("failedLoad")}</p>
          </CardContent>
        </Card>
      ) : recordings.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">{t("empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colTitle")}</TableHead>
                <TableHead className="w-28">{t("colKind")}</TableHead>
                <TableHead className="w-24">{t("colDuration")}</TableHead>
                <TableHead className="w-24">{t("colSize")}</TableHead>
                <TableHead className="w-28 text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recordings.map((recording) => (
                <TableRow key={recording.id}>
                  <TableCell>
                    <span className={recording.status === "pending" ? "text-muted-foreground" : ""}>
                      {recording.title}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t(recording.kind)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDuration(recording.durationSeconds)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatBytes(recording.sizeBytes)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("open")}
                      onClick={() => handleOpen(recording.id)}
                      disabled={recording.status !== "ready" || openRecording.isPending}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("delete")}
                      onClick={() => handleDelete(recording.id)}
                      disabled={deleteRecording.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
