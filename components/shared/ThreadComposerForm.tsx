"use client";

import { LoaderCircle, PencilLine, Plus, Trash2 } from "lucide-react";

type ThreadTypeValue = "GENERAL" | "TEAM";

export type ThreadComposerFormDraft = {
  title: string;
  body: string;
  tags: string;
  includePoll: boolean;
  pollQuestion: string;
  pollOptions: string[];
  pollDeadline: string;
  type?: ThreadTypeValue;
  teamId?: string;
};

type TeamOption = {
  id: number;
  name: string;
};

type ThreadComposerFormProps<T extends ThreadComposerFormDraft> = {
  draft: T;
  onChange: (next: T) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  errorMessage?: string | null;
  tagsPlaceholder?: string;
  pollQuestionPlaceholder?: string;
  showTypeToggle?: boolean;
  threadType?: ThreadTypeValue;
  onThreadTypeChange?: (type: ThreadTypeValue) => void;
  showTeamField?: boolean;
  teamFieldMode?: "locked" | "select";
  teamLabel?: string;
  teamId?: string;
  onTeamIdChange?: (value: string) => void;
  lockedTeamLabel?: string;
  teams?: TeamOption[];
  teamsLoading?: boolean;
  teamsError?: string | null;
  teamSelectPlaceholder?: string;
  submitLabel?: string;
  pendingLabel?: string;
  showCancel?: boolean;
  bodyRows?: number;
  footerRightText?: string;
};

export default function ThreadComposerForm<T extends ThreadComposerFormDraft>({
  draft,
  onChange,
  onSubmit,
  onCancel,
  disabled = false,
  errorMessage = null,
  tagsPlaceholder = "analysis, title-race, transfers",
  pollQuestionPlaceholder = "Who was the best player on the pitch?",
  showTypeToggle = false,
  threadType,
  onThreadTypeChange,
  showTeamField = false,
  teamFieldMode = "select",
  teamLabel = "Team",
  teamId = "",
  onTeamIdChange,
  lockedTeamLabel = "Selected Team",
  teams = [],
  teamsLoading = false,
  teamsError = null,
  teamSelectPlaceholder = "Choose a team",
  submitLabel = "Create Thread",
  pendingLabel = "Publishing...",
  showCancel = true,
  bodyRows = 6,
  footerRightText = "Up to 5 tags",
}: ThreadComposerFormProps<T>) {
  const updateDraft = (patch: Partial<T>) => {
    onChange({
      ...draft,
      ...patch,
    });
  };

  const options = draft.pollOptions || [];

  return (
    <div className="space-y-4">
      {showTypeToggle && threadType && onThreadTypeChange && (
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: "GENERAL" as const, label: "General" },
            { value: "TEAM" as const, label: "Team" },
          ]).map((option) => {
            const active = threadType === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onThreadTypeChange(option.value)}
                disabled={disabled}
                className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  active
                    ? "border-sky-500 bg-sky-500/10 text-sky-600"
                    : "border-[color:var(--surface-border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      <label className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
          Title
        </span>
        <input
          value={draft.title}
          onChange={(event) => updateDraft({ title: event.target.value } as Partial<T>)}
          placeholder="Give the thread a clear headline..."
          disabled={disabled}
          className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-foreground)] focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </label>

      {showTeamField && (
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
            {teamLabel}
          </span>
          {teamFieldMode === "locked" ? (
            <div className="w-full rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm font-semibold text-[color:var(--foreground)]">
              {lockedTeamLabel}
            </div>
          ) : (
            <select
              value={teamId}
              onChange={(event) => onTeamIdChange?.(event.target.value)}
              disabled={disabled || teamsLoading}
              className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">{teamsLoading ? "Loading teams..." : teamSelectPlaceholder}</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          )}
          {teamsError ? <p className="text-xs text-rose-500">{teamsError}</p> : null}
        </label>
      )}

      <label className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
          Body
        </span>
        <textarea
          value={draft.body}
          onChange={(event) => updateDraft({ body: event.target.value } as Partial<T>)}
          placeholder="Kick off the conversation..."
          rows={bodyRows}
          disabled={disabled}
          className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-foreground)] focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </label>

      <label className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
          Tags
        </span>
        <input
          value={draft.tags}
          onChange={(event) => updateDraft({ tags: event.target.value } as Partial<T>)}
          placeholder={tagsPlaceholder}
          disabled={disabled}
          className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-foreground)] focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </label>

      <div className="flex items-center justify-between gap-3 text-xs text-[color:var(--muted-foreground)]">
        <span>{draft.body.trim().length}/10000 characters</span>
        <span>{footerRightText}</span>
      </div>

      <div className="rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-elevated)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[color:var(--foreground)]">Optional Poll</p>
            <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
              Add a poll to your thread so readers can vote.
            </p>
          </div>
          <button
            type="button"
            onClick={() => updateDraft({ includePoll: !draft.includePoll } as Partial<T>)}
            disabled={disabled}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              draft.includePoll
                ? "border-sky-500 bg-sky-500/10 text-sky-600"
                : "border-[color:var(--surface-border)] text-[color:var(--muted-foreground)]"
            }`}
          >
            {draft.includePoll ? "Poll On" : "Add Poll"}
          </button>
        </div>

        {draft.includePoll && (
          <div className="mt-4 space-y-3">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                Question
              </span>
              <input
                value={draft.pollQuestion}
                onChange={(event) => updateDraft({ pollQuestion: event.target.value } as Partial<T>)}
                disabled={disabled}
                placeholder={pollQuestionPlaceholder}
                className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-foreground)] focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                Options
              </span>
              <div className="space-y-2">
                {options.map((option, index) => (
                  <div key={`composer-option-${index}`} className="flex items-center gap-2">
                    <input
                      value={option}
                      onChange={(event) =>
                        updateDraft({
                          pollOptions: options.map((currentOption, optionIndex) =>
                            optionIndex === index ? event.target.value : currentOption
                          ),
                        } as Partial<T>)
                      }
                      disabled={disabled}
                      placeholder={`Option ${index + 1}`}
                      className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-foreground)] focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    {options.length > 2 && (
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft({
                            pollOptions: options.filter((_, optionIndex) => optionIndex !== index),
                          } as Partial<T>)
                        }
                        disabled={disabled}
                        className="btn-secondary whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={`Remove poll option ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between gap-3 text-xs text-[color:var(--muted-foreground)]">
                <span>2 to 10 options</span>
                {options.length < 10 && (
                  <button
                    type="button"
                    onClick={() =>
                      updateDraft({
                        pollOptions: [...options, ""],
                      } as Partial<T>)
                    }
                    disabled={disabled}
                    className="inline-flex items-center gap-1 font-semibold text-sky-600 transition hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add option
                  </button>
                )}
              </div>
            </div>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                Deadline
              </span>
              <input
                type="datetime-local"
                value={draft.pollDeadline}
                onChange={(event) => updateDraft({ pollDeadline: event.target.value } as Partial<T>)}
                disabled={disabled}
                className="w-full rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-[color:var(--foreground)]">
          {errorMessage}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        {showCancel && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {disabled ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              {pendingLabel}
            </>
          ) : (
            <>
              <PencilLine className="h-4 w-4" />
              {submitLabel}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
