export type ThreadComposerCoreState = {
  title: string;
  body: string;
  tags: string;
  includePoll: boolean;
  pollQuestion: string;
  pollOptions: string[];
  pollDeadline: string;
};

export const INITIAL_THREAD_COMPOSER_CORE_STATE: ThreadComposerCoreState = {
  title: "",
  body: "",
  tags: "",
  includePoll: false,
  pollQuestion: "",
  pollOptions: ["", ""],
  pollDeadline: "",
};

export function getDefaultPollDeadline() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function normalizeThreadTags(rawTags: string) {
  return [
    ...new Set(
      rawTags
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

export function normalizePollOptions(options: string[]) {
  return options.map((value) => value.trim()).filter(Boolean);
}
