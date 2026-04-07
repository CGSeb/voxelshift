import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FileCode, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { Tooltip } from "../components/Tooltip";
import type { CreatePlannerRunPayload } from "../lib/api";
import type { BlenderVersion, PlannerRunSummary } from "../types";

interface PlannerPageProps {
  blenderVersions: BlenderVersion[];
  plannerRuns: PlannerRunSummary[];
  errorMessage: string | null;
  submitErrorMessage: string | null;
  noticeMessage: string | null;
  isLoading: boolean;
  isCreating: boolean;
  onCreateRun: (payload: CreatePlannerRunPayload) => Promise<boolean>;
  onUpdateRun: (runId: string, payload: CreatePlannerRunPayload) => Promise<boolean>;
  onBrowseBlendFile: () => Promise<string | null>;
  onBrowseCustomBlender: () => Promise<string | null>;
  onBrowseOutputFolder: () => Promise<string | null>;
  onOpenLogs: (run: PlannerRunSummary) => void;
  onDeleteRun: (run: PlannerRunSummary) => void;
}

const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayLabelFormatter = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const monthLabelFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const triggerDateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const weekdayLabels = Array.from({ length: 7 }, (_, index) => weekdayFormatter.format(new Date(Date.UTC(2024, 0, 7 + index))));

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateTimeValue(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function parseDateTimeValue(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function createDefaultStartTime() {
  const date = new Date(Date.now() + 5 * 60_000);
  date.setSeconds(0, 0);
  return formatDateTimeValue(date);
}

function createMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function shiftMonth(date: Date, offset: number) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function buildCalendarDays(monthStart: Date) {
  const firstVisibleDay = new Date(monthStart);
  firstVisibleDay.setDate(1 - firstVisibleDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstVisibleDay);
    date.setDate(firstVisibleDay.getDate() + index);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      date,
      inCurrentMonth: date.getMonth() === monthStart.getMonth(),
    };
  });
}


function formatDuration(seconds: number | null) {
  if (seconds === null || Number.isNaN(seconds) || !Number.isFinite(seconds)) {
    return "-";
  }

  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

function formatRelativeStart(timestamp: number) {
  const now = Math.floor(Date.now() / 1000);
  const difference = timestamp - now;
  const absoluteSeconds = Math.abs(difference);
  const days = Math.floor(absoluteSeconds / 86400);
  const hours = Math.floor((absoluteSeconds % 86400) / 3600);
  const minutes = Math.floor((absoluteSeconds % 3600) / 60);

  let value = "Now";
  if (days > 0) {
    value = `${days}d${hours > 0 ? `${hours}h` : ""}`;
  } else if (hours > 0) {
    value = `${hours}h${padDatePart(minutes)}`;
  } else if (minutes > 0) {
    value = `${minutes}m`;
  }

  if (value === "Now") {
    return value;
  }

  return difference >= 0 ? `In ${value}` : `${value} ago`;
}

function formatStatusMeta(run: PlannerRunSummary) {
  const segments = [formatRelativeStart(run.startAt)];

  if (run.status === "completed" && run.averageRenderTimeSeconds !== null && run.renderedFrameCount > 0) {
    segments.push(formatDuration(run.averageRenderTimeSeconds * run.renderedFrameCount));
  }

  return segments.join(" • ");
}

function formatRunName(run: PlannerRunSummary) {
  const segments = run.blendFilePath.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? run.blendFilePath;
}

function formatStartTimeLabel(value: string) {
  const date = parseDateTimeValue(value);
  if (!date) {
    return "Choose a start time";
  }

  return triggerDateTimeFormatter.format(date);
}
function timestampToLocalDateTimeValue(timestamp: number) {
  return formatDateTimeValue(new Date(timestamp * 1000));
}

function getStatusLabel(status: PlannerRunSummary["status"]) {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    default:
      return "Failed";
  }
}

function getRunProgressLabel(run: PlannerRunSummary) {
  if (run.status === "running") {
    return run.currentFrame !== null ? `Frame ${run.currentFrame} of ${run.endFrame}` : "Waiting for frame output";
  }

  if (run.status === "failed") {
    return run.lastErrorMessage ?? "Render failed";
  }

  return null;
}

function resetPlannerFormState(setters: {
  setBlendFilePath: (value: string) => void;
  setStartFrame: (value: string) => void;
  setEndFrame: (value: string) => void;
  setStartTime: (value: string) => void;
  setStartTimePickerMonth: (value: Date) => void;
  setBlenderSource: (value: "library" | "custom") => void;
  setCustomExecutablePath: (value: string) => void;
  setOverrideOutputFolder: (value: boolean) => void;
  setOutputFolderPath: (value: string) => void;
  setShutdownWhenDone: (value: boolean) => void;
}) {
  const nextStartTime = createDefaultStartTime();
  setters.setBlendFilePath("");
  setters.setStartFrame("1");
  setters.setEndFrame("250");
  setters.setStartTime(nextStartTime);
  setters.setStartTimePickerMonth(createMonthStart(parseDateTimeValue(nextStartTime) ?? new Date()));
  setters.setBlenderSource("library");
  setters.setCustomExecutablePath("");
  setters.setOverrideOutputFolder(false);
  setters.setOutputFolderPath("");
  setters.setShutdownWhenDone(false);
}

export function PlannerPage({
  blenderVersions,
  plannerRuns,
  errorMessage,
  submitErrorMessage,
  noticeMessage,
  isLoading,
  isCreating,
  onCreateRun,
  onUpdateRun,
  onBrowseBlendFile,
  onBrowseCustomBlender,
  onBrowseOutputFolder,
  onOpenLogs,
  onDeleteRun,
}: PlannerPageProps) {
  const [blendFilePath, setBlendFilePath] = useState("");
  const [startFrame, setStartFrame] = useState("1");
  const [endFrame, setEndFrame] = useState("250");
  const [startTime, setStartTime] = useState(() => createDefaultStartTime());
  const [blenderSource, setBlenderSource] = useState<"library" | "custom">("library");
  const [libraryVersionId, setLibraryVersionId] = useState("");
  const [customExecutablePath, setCustomExecutablePath] = useState("");
  const [overrideOutputFolder, setOverrideOutputFolder] = useState(false);
  const [outputFolderPath, setOutputFolderPath] = useState("");
  const [shutdownWhenDone, setShutdownWhenDone] = useState(false);
  const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(null);
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isLibraryPickerOpen, setIsLibraryPickerOpen] = useState(false);
  const [isStartTimePickerOpen, setIsStartTimePickerOpen] = useState(false);
  const [startTimePickerMonth, setStartTimePickerMonth] = useState(() => createMonthStart(new Date()));
  const startTimePickerRef = useRef<HTMLDivElement | null>(null);

  const selectedStartDate = useMemo(() => parseDateTimeValue(startTime) ?? new Date(), [startTime]);
  const isEditing = editingRunId !== null;
  const sortedVersions = useMemo(
    () => [...blenderVersions].sort((left, right) => left.displayName.localeCompare(right.displayName)),
    [blenderVersions],
  );
  const calendarDays = useMemo(() => buildCalendarDays(startTimePickerMonth), [startTimePickerMonth]);

  useEffect(() => {
    if (!libraryVersionId && blenderVersions.length > 0) {
      setLibraryVersionId(blenderVersions[0].id);
    }
  }, [blenderVersions, libraryVersionId]);

  useEffect(() => {
    if (!isScheduleModalOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || isCreating) {
        return;
      }

      if (isStartTimePickerOpen) {
        setIsStartTimePickerOpen(false);
        return;
      }

      if (isLibraryPickerOpen) {
        setIsLibraryPickerOpen(false);
        return;
      }

      setIsScheduleModalOpen(false);
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCreating, isLibraryPickerOpen, isScheduleModalOpen, isStartTimePickerOpen]);

  useEffect(() => {
    if (!isStartTimePickerOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (startTimePickerRef.current?.contains(target)) {
        return;
      }

      setIsStartTimePickerOpen(false);
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isStartTimePickerOpen]);

  function openScheduleModal(run?: PlannerRunSummary) {
    setEditingRunId(null);
    setLocalErrorMessage(null);
    setIsLibraryPickerOpen(false);
    setIsStartTimePickerOpen(false);
    if (run) {
      populateFormFromRun(run);
    } else {
      resetPlannerFormState({
        setBlendFilePath,
        setStartFrame,
        setEndFrame,
        setStartTime,
        setStartTimePickerMonth,
        setBlenderSource,
        setCustomExecutablePath,
        setOverrideOutputFolder,
        setOutputFolderPath,
        setShutdownWhenDone,
      });
    }
    setIsScheduleModalOpen(true);
  }

  function openEditModal(run: PlannerRunSummary) {
    setEditingRunId(run.id);
    setLocalErrorMessage(null);
    setIsLibraryPickerOpen(false);
    setIsStartTimePickerOpen(false);
    populateFormFromRun(run);
    setIsScheduleModalOpen(true);
  }

  function closeScheduleModal() {
    if (isCreating) {
      return;
    }

    setEditingRunId(null);
    setLocalErrorMessage(null);
    setIsLibraryPickerOpen(false);
    setIsStartTimePickerOpen(false);
    setIsScheduleModalOpen(false);
  }

  function toggleStartTimePicker() {
    setIsLibraryPickerOpen(false);
    setStartTimePickerMonth(createMonthStart(selectedStartDate));
    setIsStartTimePickerOpen((current) => !current);
  }
  function populateFormFromRun(run?: PlannerRunSummary) {
    if (!run) {
      return;
    }

    setBlendFilePath(run.blendFilePath);
    setStartFrame(String(run.startFrame));
    setEndFrame(String(run.endFrame));
    setStartTime(timestampToLocalDateTimeValue(run.startAt));
    setStartTimePickerMonth(createMonthStart(new Date(run.startAt * 1000)));
    setBlenderSource(run.blenderTarget.source);
    setLibraryVersionId(run.blenderTarget.versionId ?? libraryVersionId);
    setCustomExecutablePath(run.blenderTarget.source === "custom" ? run.blenderTarget.executablePath : "");
    setOverrideOutputFolder(Boolean(run.outputFolderPath));
    setOutputFolderPath(run.outputFolderPath ?? "");
    setShutdownWhenDone(run.shutdownWhenDone);
  }

  function updateStartDate(nextDate: Date) {
    const next = new Date(selectedStartDate);
    next.setFullYear(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate());
    next.setSeconds(0, 0);
    setStartTime(formatDateTimeValue(next));
  }

  function updateStartTimePart(part: "hours" | "minutes", value: string) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return;
    }

    const next = new Date(selectedStartDate);
    if (part === "hours") {
      next.setHours(Math.min(23, Math.max(0, parsed)));
    } else {
      next.setMinutes(Math.min(59, Math.max(0, parsed)));
    }
    next.setSeconds(0, 0);
    setStartTime(formatDateTimeValue(next));
  }

  async function handleBrowseBlendFile() {
    const selected = await onBrowseBlendFile();
    if (selected) {
      setBlendFilePath(selected);
      setLocalErrorMessage(null);
    }
  }

  async function handleBrowseCustomBlender() {
    const selected = await onBrowseCustomBlender();
    if (selected) {
      setCustomExecutablePath(selected);
      setLocalErrorMessage(null);
    }
  }

  async function handleBrowseOutputFolder() {
    const selected = await onBrowseOutputFolder();
    if (selected) {
      setOutputFolderPath(selected);
      setLocalErrorMessage(null);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalErrorMessage(null);

    const scheduledDate = new Date(startTime);
    const startAt = Math.floor(scheduledDate.getTime() / 1000);
    if (Number.isNaN(startAt)) {
      setLocalErrorMessage("Please choose a valid start time.");
      return;
    }

    const parsedStartFrame = Number.parseInt(startFrame, 10);
    const parsedEndFrame = Number.parseInt(endFrame, 10);
    if (Number.isNaN(parsedStartFrame) || Number.isNaN(parsedEndFrame)) {
      setLocalErrorMessage("Please enter valid frame numbers.");
      return;
    }

    if (overrideOutputFolder && !outputFolderPath.trim()) {
      setLocalErrorMessage("Please choose an output folder.");
      return;
    }

    const payload = {
      blendFilePath,
      startFrame: parsedStartFrame,
      endFrame: parsedEndFrame,
      startAt,
      outputFolderPath: overrideOutputFolder ? outputFolderPath.trim() : null,
      shutdownWhenDone,
      blender: {
        source: blenderSource,
        versionId: blenderSource === "library" ? libraryVersionId : null,
        executablePath: blenderSource === "custom" ? customExecutablePath : null,
      },
    } satisfies CreatePlannerRunPayload;

    const saved = editingRunId ? await onUpdateRun(editingRunId, payload) : await onCreateRun(payload);

    if (saved) {
      resetPlannerFormState({
        setBlendFilePath,
        setStartFrame,
        setEndFrame,
        setStartTime,
        setStartTimePickerMonth,
        setBlenderSource,
        setCustomExecutablePath,
        setOverrideOutputFolder,
        setOutputFolderPath,
        setShutdownWhenDone,
      });
      setEditingRunId(null);
      setLocalErrorMessage(null);
      setIsLibraryPickerOpen(false);
      setIsStartTimePickerOpen(false);
      setIsScheduleModalOpen(false);
    }
  }

  return (
    <section className="planner-page">
      {errorMessage ? (
        <section className="release-state release-state-error">
          <h3>Could not load planner runs</h3>
          <p>{errorMessage}</p>
        </section>
      ) : null}


      <section className="planner-runs-panel">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Queue</p>
            <h3>Planned and past renders</h3>
          </div>
          <button className="card-action card-action-secondary" type="button" onClick={() => openScheduleModal()}>
            Schedule
          </button>
        </div>

        {isLoading && plannerRuns.length === 0 ? (
          <section className="release-state">
            <h3>Loading planner runs</h3>
            <p>Collecting pending schedules and render history.</p>
          </section>
        ) : plannerRuns.length === 0 ? (
          <section className="release-state planner-empty-state">
            <h3>No renders scheduled yet</h3>
            <p>Your queued background renders and their history will show up here.</p>
          </section>
        ) : (
          <div className="planner-run-list">
            {plannerRuns.map((run) => (
              <article className="planner-run-card" key={run.id}>
                <div className="planner-run-header">
                  <div className="planner-run-title-block">
                    <div className="planner-status-line">
                      <span className={`planner-status-dot planner-status-dot-${run.status}`} aria-hidden="true" />
                      <span className={`planner-status-pill planner-status-pill-${run.status}`}>{getStatusLabel(run.status)}</span>
                      <span className="planner-status-schedule">{formatStatusMeta(run)}</span>
                    </div>
                    <h4>{formatRunName(run)}</h4>
                    <p>{run.blenderTarget.displayName}</p>
                  </div>
                  <div className="planner-run-actions">
                    <Tooltip content="Duplicate render">
                      <button className="running-blender-action-button" type="button" onClick={() => openScheduleModal(run)} aria-label={`Duplicate ${formatRunName(run)}`}>
                        <Copy className="release-launch-icon" aria-hidden="true" strokeWidth={1.75} />
                      </button>
                    </Tooltip>
                    {run.status === "pending" ? (
                      <Tooltip content="Edit render">
                        <button className="running-blender-action-button" type="button" onClick={() => openEditModal(run)} aria-label={`Edit ${formatRunName(run)}`}>
                          <Pencil className="release-launch-icon" aria-hidden="true" strokeWidth={1.75} />
                        </button>
                      </Tooltip>
                    ) : (
                      <Tooltip content="View logs">
                        <button className="running-blender-action-button" type="button" onClick={() => onOpenLogs(run)} aria-label={`Open logs for ${formatRunName(run)}`}>
                          <FileCode className="release-launch-icon" aria-hidden="true" strokeWidth={1.75} />
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip content={run.status === "running" ? "Running renders cannot be deleted" : "Delete render"}>
                      <button
                        className="running-blender-action-button running-blender-action-button-danger"
                        type="button"
                        onClick={() => onDeleteRun(run)}
                        aria-label={`Delete ${formatRunName(run)}`}
                        disabled={run.status === "running"}
                      >
                        <Trash2 className="release-launch-icon" aria-hidden="true" strokeWidth={1.75} />
                      </button>
                    </Tooltip>
                  </div>
                </div>

                <div className="planner-run-grid">
                  <div>
                    <span className="section-kicker">Frames</span>
                    <p>
                      {run.startFrame}-{run.endFrame}
                    </p>
                  </div>
                  <div>
                    <span className="section-kicker">Current frame</span>
                    <p>{run.currentFrame ?? "-"}</p>
                  </div>
                  <div>
                    <span className="section-kicker">Average / ETA</span>
                    <p>
                      {formatDuration(run.averageRenderTimeSeconds)} / {formatDuration(run.estimatedRemainingSeconds)}
                    </p>
                  </div>
                  {run.shutdownWhenDone ? (
                    <div>
                      <span className="section-kicker">After render</span>
                      <p>
                        <span className="planner-shutdown-badge">Shutdown</span>
                      </p>
                    </div>
                  ) : null}
                </div>

                {getRunProgressLabel(run) || run.pid ? (
                  <div className="planner-run-footer">
                    {getRunProgressLabel(run) ? <p>{getRunProgressLabel(run)}</p> : <span />}
                    {run.pid ? <span className="section-badge">PID {run.pid}</span> : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      {isScheduleModalOpen ? (
        <div className="confirm-dialog-backdrop" role="presentation" onClick={closeScheduleModal}>
          <section
            className="release-config-dialog planner-schedule-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="planner-schedule-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <form className="planner-form-card planner-form-card-modal" onSubmit={handleSubmit}>
              <div className="planner-form-copy">
                <p className="section-kicker">{isEditing ? "Edit Render" : "New Render"}</p>
                <h2 id="planner-schedule-dialog-title">{isEditing ? "Edit a planned background animation render" : "Schedule a background animation render"}</h2>
                <p className="release-config-dialog-description">
                  Render output uses the settings already saved inside the selected Blender project unless you override the folder below.
                </p>
              </div>

              <label className="release-config-field">
                <span>Blend file</span>
                <div className="planner-input-row">
                  <input
                    className="release-config-input"
                    type="text"
                    value={blendFilePath}
                    onChange={(event) => setBlendFilePath(event.target.value)}
                    placeholder="D:\\Projects\\scene.blend"
                  />
                  <button
                    className="card-action card-action-secondary planner-inline-button"
                    type="button"
                    onClick={() => void handleBrowseBlendFile()}
                    aria-label="Browse blend file"
                  >
                    <FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" />
                    Browse
                  </button>
                </div>
              </label>

              <div className="planner-form-grid planner-form-grid-schedule">
                <label className="release-config-field">
                  <span>Start frame</span>
                  <input className="release-config-input" type="number" min="1" value={startFrame} onChange={(event) => setStartFrame(event.target.value)} />
                </label>

                <label className="release-config-field">
                  <span>End frame</span>
                  <input className="release-config-input" type="number" min="1" value={endFrame} onChange={(event) => setEndFrame(event.target.value)} />
                </label>

                <div className="release-config-field planner-date-picker-field" ref={startTimePickerRef}>
                  <span>Start time</span>
                  <div className="planner-date-picker">
                    <button
                      className={isStartTimePickerOpen ? "release-config-input planner-date-trigger planner-date-trigger-open" : "release-config-input planner-date-trigger"}
                      type="button"
                      aria-haspopup="dialog"
                      aria-expanded={isStartTimePickerOpen}
                      aria-label="Choose start time"
                      onClick={toggleStartTimePicker}
                    >
                      <span className="planner-date-trigger-copy">
                        <CalendarDays className="planner-date-trigger-icon" size={16} strokeWidth={1.9} aria-hidden="true" />
                        <span className="planner-date-trigger-text">{formatStartTimeLabel(startTime)}</span>
                      </span>
                      <ChevronDown className={isStartTimePickerOpen ? "planner-select-chevron planner-select-chevron-open" : "planner-select-chevron"} size={16} strokeWidth={2} aria-hidden="true" />
                    </button>

                    {isStartTimePickerOpen ? (
                      <div className="planner-date-popover" role="dialog" aria-label="Start time picker">
                        <div className="planner-date-popover-header">
                          <p className="section-kicker">Render start</p>
                          <span className="planner-date-summary">{formatStartTimeLabel(startTime)}</span>
                        </div>

                        <div className="planner-date-calendar-header">
                          <button
                            className="planner-date-nav"
                            type="button"
                            onClick={() => setStartTimePickerMonth((current) => shiftMonth(current, -1))}
                            aria-label="Show previous month"
                          >
                            <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
                          </button>
                          <h4 className="planner-date-month-label">{monthLabelFormatter.format(startTimePickerMonth)}</h4>
                          <button
                            className="planner-date-nav"
                            type="button"
                            onClick={() => setStartTimePickerMonth((current) => shiftMonth(current, 1))}
                            aria-label="Show next month"
                          >
                            <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>

                        <div className="planner-date-weekdays" aria-hidden="true">
                          {weekdayLabels.map((label) => (
                            <span key={label}>{label}</span>
                          ))}
                        </div>

                        <div className="planner-date-grid">
                          {calendarDays.map((day) => {
                            const isSelected = isSameDay(day.date, selectedStartDate);
                            const isToday = isSameDay(day.date, new Date());
                            const className = [
                              "planner-date-day",
                              day.inCurrentMonth ? null : "planner-date-day-muted",
                              isToday ? "planner-date-day-today" : null,
                              isSelected ? "planner-date-day-selected" : null,
                            ]
                              .filter(Boolean)
                              .join(" ");

                            return (
                              <button
                                key={day.key}
                                className={className}
                                type="button"
                                onClick={() => updateStartDate(day.date)}
                                aria-pressed={isSelected}
                                aria-label={dayLabelFormatter.format(day.date)}
                              >
                                {day.date.getDate()}
                              </button>
                            );
                          })}
                        </div>

                        <div className="planner-date-time-panel">
                          <div className="planner-date-time-inputs">
                            <label className="planner-date-time-group">
                              <span>Hour</span>
                              <input
                                className="release-config-input planner-date-time-input"
                                type="number"
                                min="0"
                                max="23"
                                value={padDatePart(selectedStartDate.getHours())}
                                onChange={(event) => updateStartTimePart("hours", event.target.value)}
                              />
                            </label>
                            <span className="planner-date-time-separator">:</span>
                            <label className="planner-date-time-group">
                              <span>Minute</span>
                              <input
                                className="release-config-input planner-date-time-input"
                                type="number"
                                min="0"
                                max="59"
                                value={padDatePart(selectedStartDate.getMinutes())}
                                onChange={(event) => updateStartTimePart("minutes", event.target.value)}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="release-config-field">
                <span>Blender to use</span>
                <div className="release-tab-bar release-tab-bar-secondary" role="tablist" aria-label="Planner Blender source">
                  <button
                    className={blenderSource === "library" ? "release-tab release-tab-active" : "release-tab"}
                    type="button"
                    role="tab"
                    aria-selected={blenderSource === "library"}
                    onClick={() => {
                      setBlenderSource("library");
                      setIsStartTimePickerOpen(false);
                      setIsLibraryPickerOpen(false);
                    }}
                  >
                    Library
                  </button>
                  <button
                    className={blenderSource === "custom" ? "release-tab release-tab-active" : "release-tab"}
                    type="button"
                    role="tab"
                    aria-selected={blenderSource === "custom"}
                    onClick={() => {
                      setBlenderSource("custom");
                      setIsStartTimePickerOpen(false);
                      setIsLibraryPickerOpen(false);
                    }}
                  >
                    Custom build
                  </button>
                </div>
              </div>

              {blenderSource === "library" ? (
                <div className="release-config-field">
                  <span>Installed Blender</span>
                  <div className="planner-select-shell">
                    <button
                      className={isLibraryPickerOpen ? "release-config-input planner-select-trigger planner-select-trigger-open" : "release-config-input planner-select-trigger"}
                      type="button"
                      onClick={() => {
                        setIsStartTimePickerOpen(false);
                        setIsLibraryPickerOpen((current) => !current);
                      }}
                      aria-haspopup="listbox"
                      aria-expanded={isLibraryPickerOpen}
                      aria-label="Installed Blender"
                      disabled={sortedVersions.length === 0}
                    >
                      <span className="planner-select-value">
                        {sortedVersions.find((version) => version.id === libraryVersionId)?.displayName ?? "No installed Blender versions found"}
                      </span>
                      <ChevronDown className={isLibraryPickerOpen ? "planner-select-chevron planner-select-chevron-open" : "planner-select-chevron"} size={16} strokeWidth={2} aria-hidden="true" />
                    </button>

                    {isLibraryPickerOpen ? (
                      <div className="planner-select-menu" role="listbox" aria-label="Installed Blender versions">
                        {sortedVersions.length > 0 ? (
                          sortedVersions.map((version) => {
                            const isSelected = version.id === libraryVersionId;

                            return (
                              <button
                                key={version.id}
                                className={isSelected ? "planner-select-option planner-select-option-active" : "planner-select-option"}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => {
                                  setLibraryVersionId(version.id);
                                  setIsLibraryPickerOpen(false);
                                }}
                              >
                                <span>{version.displayName}</span>
                                {isSelected ? <Check className="planner-select-check" size={16} strokeWidth={2.2} aria-hidden="true" /> : null}
                              </button>
                            );
                          })
                        ) : (
                          <div className="planner-select-option planner-select-option-empty" role="option" aria-selected="false">
                            No installed Blender versions found
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <label className="release-config-field">
                  <span>Custom Blender executable</span>
                  <div className="planner-input-row">
                    <input
                      className="release-config-input"
                      type="text"
                      value={customExecutablePath}
                      onChange={(event) => setCustomExecutablePath(event.target.value)}
                      placeholder="D:\\Tools\\Blender\\blender.exe"
                    />
                    <button
                      className="card-action card-action-secondary planner-inline-button"
                      type="button"
                      onClick={() => void handleBrowseCustomBlender()}
                      aria-label="Browse custom Blender executable"
                    >
                      <FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" />
                      Browse
                    </button>
                  </div>
                </label>
              )}

              <label className="planner-checkbox-field">
                <span className="planner-checkbox-row">
                  <input
                    className="planner-checkbox-input"
                    type="checkbox"
                    aria-label="Override output folder"
                    checked={overrideOutputFolder}
                    onChange={(event) => setOverrideOutputFolder(event.target.checked)}
                  />
                  <span>Override output folder</span>
                </span>
                <span className="planner-checkbox-copy">Send this scheduled render to a custom folder instead of the output path saved in the .blend file.</span>
              </label>

              {overrideOutputFolder ? (
                <label className="release-config-field">
                  <span>Output folder</span>
                  <div className="planner-input-row">
                    <input
                      className="release-config-input"
                      type="text"
                      value={outputFolderPath}
                      onChange={(event) => setOutputFolderPath(event.target.value)}
                      placeholder="D:\\Renders\\Shot_010"
                    />
                    <button
                      className="card-action card-action-secondary planner-inline-button"
                      type="button"
                      onClick={() => void handleBrowseOutputFolder()}
                      aria-label="Browse output folder"
                    >
                      <FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" />
                      Browse
                    </button>
                  </div>
                </label>
              ) : null}

              <label className="planner-checkbox-field">
                <span className="planner-checkbox-row">
                  <input
                    className="planner-checkbox-input"
                    type="checkbox"
                    aria-label="Shut down computer when render is done"
                    checked={shutdownWhenDone}
                    onChange={(event) => setShutdownWhenDone(event.target.checked)}
                  />
                  <span>Shut down computer when render is done</span>
                </span>
                <span className="planner-checkbox-copy">After a successful render, Windows will shut down this computer after a 10 second delay.</span>
              </label>

              {localErrorMessage || submitErrorMessage ? <p className="confirm-dialog-error">{localErrorMessage ?? submitErrorMessage}</p> : null}

              <div className="confirm-dialog-actions planner-form-actions">
                <button className="card-action card-action-secondary" type="button" onClick={closeScheduleModal} disabled={isCreating}>
                  Cancel
                </button>
                <button className="card-action" type="submit" disabled={isCreating || (blenderSource === "library" && sortedVersions.length === 0)}>
                  {isCreating ? (isEditing ? "Saving..." : "Scheduling...") : (isEditing ? "Save changes" : "Schedule render")}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}





























