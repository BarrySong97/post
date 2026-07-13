/**
 * @purpose Build subject-aware labels for background tasks in the footer.
 * @role    Pure helpers that take an i18n `t` so unit tests can stub translations.
 * @deps    BackgroundTask subject shape from RouterOutputs.
 * @gotcha  Threshold is 2: ≤2 names joined, ≥3 uses a count string per task type.
 */

export type TaskLabelSubject = {
  names: string[];
  count: number;
};

export type TaskLabelInput = {
  type: string;
  subject?: TaskLabelSubject;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

function joinNames(names: string[], locale: string): string {
  const separator = locale.toLowerCase().startsWith("zh") ? "、" : ", ";
  return names.join(separator);
}

export function buildTaskTitle(task: TaskLabelInput, t: Translate, locale = "en"): string {
  const subject = task.subject;
  if (subject && subject.count > 0) {
    if (subject.count <= 2 && subject.names.length > 0) {
      return joinNames(subject.names.slice(0, subject.count), locale);
    }
    if (subject.count >= 3) {
      return t(`shell.taskSubjectMany.${task.type}`, { count: subject.count });
    }
  }

  return t(`shell.taskType.${task.type}`);
}

export function buildPillLabel(task: TaskLabelInput, t: Translate, locale = "en"): string {
  const subject = task.subject;
  if (subject && subject.count > 0) {
    if (subject.count <= 2 && subject.names.length > 0) {
      const named = joinNames(subject.names.slice(0, subject.count), locale);
      if (task.type === "thumbnails" || task.type === "import") {
        return t(`shell.pillRunningNamed.${task.type}`, { name: named });
      }
      return named;
    }
    if (subject.count >= 3) {
      return t(`shell.taskSubjectMany.${task.type}`, { count: subject.count });
    }
  }

  return t("shell.taskRunning", { label: t(`shell.taskType.${task.type}`) });
}
