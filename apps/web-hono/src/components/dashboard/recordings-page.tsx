import * as stylex from "@stylexjs/stylex";
import { toast } from "sonner";
import { ExternalLink, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useDeleteRecording, useOpenRecording, useRecordings } from "@/hooks/use-recordings";
import { bp, kl, tone } from "./dashboard.stylex";
import { Button, PageHeading, PageStack, Skeleton, Tag } from "./ui";

/** The fields of a legacy recording this page shows. */
export interface RecordingRow {
  id: string;
  title: string;
  kind: "recording" | "screenshot";
  status: string;
  durationSeconds: number;
  sizeBytes: number;
}

/** Human-readable size; recordings run from a few KB (screenshot) to GBs (video). */
export function formatBytes(bytes: number): string {
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

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export interface RecordingsViewProps {
  recordings: RecordingRow[];
  isPending: boolean;
  failed: boolean;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  opening: boolean;
  deleting: boolean;
}

/**
 * `/dashboard/recordings`: the legacy recordings table (design state "Library · legacy"). A table
 * on desktop; on a phone each row becomes a card, from the same markup, so nothing is rendered
 * twice. The cloud library grid (NIW2-221) replaces it later.
 */
export function RecordingsView({
  recordings,
  isPending,
  failed,
  onRetry,
  onOpen,
  onDelete,
  opening,
  deleting,
}: RecordingsViewProps) {
  const t = useTranslations("recordings");
  const td = useTranslations("dashboard");

  let body: React.ReactNode;
  if (isPending) {
    body = [80, 65, 50].map((width) => (
      <tr key={width} {...stylex.props(s.messageRow)}>
        <td colSpan={5} {...stylex.props(s.messageCell)}>
          <Skeleton width={`${width}%`} height={18} />
        </td>
      </tr>
    ));
  } else if (failed) {
    body = (
      <tr {...stylex.props(s.messageRow)}>
        <td colSpan={5} {...stylex.props(s.messageCell)}>
          <div role="alert" {...stylex.props(s.error)}>
            <TriangleAlert size={16} aria-hidden />
            <span>{t("failedLoad")}</span>
            <Button size="sm" icon={<RefreshCw size={15} aria-hidden />} onClick={onRetry}>
              {td("retry")}
            </Button>
          </div>
        </td>
      </tr>
    );
  } else if (recordings.length === 0) {
    body = (
      <tr {...stylex.props(s.messageRow)}>
        <td colSpan={5} {...stylex.props(s.messageCell, s.empty)}>
          {t("empty")}
        </td>
      </tr>
    );
  } else {
    body = recordings.map((recording) => (
      <tr key={recording.id} {...stylex.props(s.row)}>
        <td {...stylex.props(s.cell, s.titleCell)}>
          <span {...stylex.props(s.title, recording.status === "pending" && s.titlePending)}>
            {recording.title}
          </span>
        </td>
        <td {...stylex.props(s.cell, s.metaCell)}>
          <Tag tone={recording.kind === "screenshot" ? "blue" : "pink"}>{t(recording.kind)}</Tag>
        </td>
        <td {...stylex.props(s.cell, s.metaCell, s.mono)}>
          {formatDuration(recording.durationSeconds)}
        </td>
        <td {...stylex.props(s.cell, s.metaCell, s.mono)}>{formatBytes(recording.sizeBytes)}</td>
        <td {...stylex.props(s.cell, s.actionsCell)}>
          <span {...stylex.props(s.actions)}>
            <button
              type="button"
              aria-label={t("open")}
              title={t("open")}
              onClick={() => onOpen(recording.id)}
              disabled={recording.status !== "ready" || opening}
              {...stylex.props(s.iconBtn)}
            >
              <ExternalLink size={15} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={t("delete")}
              title={t("delete")}
              onClick={() => onDelete(recording.id)}
              disabled={deleting}
              {...stylex.props(s.iconBtn, s.iconDanger)}
            >
              <Trash2 size={15} aria-hidden />
            </button>
          </span>
        </td>
      </tr>
    ));
  }

  return (
    <PageStack>
      <PageHeading title={t("title")} description={td("recordingsDescription")} />
      <div {...stylex.props(s.card)}>
        <table {...stylex.props(s.table)}>
          <thead {...stylex.props(s.thead)}>
            <tr>
              <th scope="col" {...stylex.props(s.th)}>
                {t("colTitle")}
              </th>
              <th scope="col" {...stylex.props(s.th)}>
                {t("colKind")}
              </th>
              <th scope="col" {...stylex.props(s.th)}>
                {t("colDuration")}
              </th>
              <th scope="col" {...stylex.props(s.th)}>
                {t("colSize")}
              </th>
              <th scope="col" {...stylex.props(s.th, s.thRight)}>
                <span {...stylex.props(s.srOnly)}>{t("colActions")}</span>
              </th>
            </tr>
          </thead>
          <tbody {...stylex.props(s.tbody)}>{body}</tbody>
        </table>
      </div>
    </PageStack>
  );
}

export function RecordingsPage() {
  const t = useTranslations("recordings");
  const { data: response, isPending, error, refetch } = useRecordings();
  const deleteRecording = useDeleteRecording();
  const openRecording = useOpenRecording();

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
    <RecordingsView
      recordings={(response?.data ?? []) as RecordingRow[]}
      isPending={isPending}
      failed={Boolean(error)}
      onRetry={() => void refetch()}
      onOpen={handleOpen}
      onDelete={handleDelete}
      opening={openRecording.isPending}
      deleting={deleteRecording.isPending}
    />
  );
}

const s = stylex.create({
  card: {
    boxSizing: "border-box",
    padding: { default: "18px 10px 6px", [bp.mobile]: 0 },
    borderWidth: { default: "1px", [bp.mobile]: 0 },
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: "16px",
    backgroundColor: { default: kl.card, [bp.mobile]: "transparent" },
  },
  table: {
    display: { default: "table", [bp.mobile]: "block" },
    width: "100%",
    borderCollapse: "collapse",
  },
  thead: { display: { default: "table-header-group", [bp.mobile]: "none" } },
  tbody: {
    display: { default: "table-row-group", [bp.mobile]: "flex" },
    flexDirection: "column",
    gap: "8px",
  },
  th: {
    paddingTop: 0,
    paddingInline: "12px",
    paddingBottom: "10px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: kl.bd,
    fontFamily: kl.fontMono,
    fontSize: "10px",
    fontWeight: 500,
    letterSpacing: "0.12em",
    textAlign: "left",
    textTransform: "uppercase",
    color: kl.faint,
  },
  thRight: { textAlign: "right" },
  row: {
    display: { default: "table-row", [bp.mobile]: "flex" },
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: "8px",
    rowGap: "6px",
    padding: { default: 0, [bp.mobile]: "12px 13px" },
    borderWidth: { default: 0, [bp.mobile]: "1px" },
    borderStyle: "solid",
    borderColor: kl.bd,
    borderRadius: { default: 0, [bp.mobile]: "12px" },
    backgroundColor: { default: "transparent", [bp.mobile]: kl.card },
  },
  cell: {
    display: { default: "table-cell", [bp.mobile]: "block" },
    paddingBlock: { default: "13px", [bp.mobile]: 0 },
    paddingInline: { default: "12px", [bp.mobile]: 0 },
    borderBottomWidth: { default: "1px", [bp.mobile]: 0 },
    borderBottomStyle: "solid",
    borderBottomColor: kl.bd,
    verticalAlign: "middle",
  },
  titleCell: { flexBasis: { default: "auto", [bp.mobile]: "100%" }, minWidth: 0 },
  metaCell: { whiteSpace: "nowrap" },
  title: {
    display: "block",
    overflow: { default: "visible", [bp.mobile]: "hidden" },
    color: kl.tx,
    fontSize: "14px",
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: { default: "normal", [bp.mobile]: "nowrap" },
  },
  titlePending: { color: kl.faint },
  mono: { fontFamily: kl.fontMono, fontSize: "12.5px", color: kl.dim },
  actionsCell: { textAlign: "right", marginLeft: { default: 0, [bp.mobile]: "auto" } },
  actions: { display: "inline-flex", gap: "4px" },
  iconBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: { default: "32px", [bp.mobile]: "44px" },
    height: { default: "32px", [bp.mobile]: "44px" },
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: kl.bd, ":focus-visible": kl.pink },
    borderRadius: "8px",
    backgroundColor: { default: "transparent", ":hover": kl.card2 },
    color: kl.dim,
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    opacity: { default: 1, ":disabled": 0.45 },
    outline: "none",
    boxShadow: { default: null, ":focus-visible": "0 0 0 3px rgba(246, 5, 92, 0.18)" },
  },
  iconDanger: { color: tone.red },
  messageRow: {
    display: { default: "table-row", [bp.mobile]: "block" },
  },
  messageCell: {
    display: { default: "table-cell", [bp.mobile]: "block" },
    padding: "12px",
  },
  empty: {
    paddingBlock: "26px",
    textAlign: "center",
    fontSize: "14px",
    lineHeight: 1.5,
    color: kl.dim,
  },
  error: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px",
    fontSize: "14px",
    color: tone.red,
  },
  srOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
});
