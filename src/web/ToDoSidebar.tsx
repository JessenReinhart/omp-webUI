import { CheckCircle2, Circle, CircleDashed, CircleSlash2, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useFeatures } from "./featureStore";
import type { TodoTask } from "./featureTypes";
import BranchedMenu, { BranchedMenuItem } from "./BranchedMenu";

const STATUS_ICON: Record<TodoTask["status"], typeof Circle> = {
  pending: Circle,
  in_progress: Loader2,
  completed: CheckCircle2,
  abandoned: CircleSlash2,
  blocked: CircleDashed,
};

const STATUS_COLOR: Record<TodoTask["status"], string> = {
  pending: "var(--muted)",
  in_progress: "var(--purple)",
  completed: "var(--green)",
  abandoned: "var(--danger)",
  blocked: "var(--amber)",
};

export function ToDoSidebar() {
  const { todoPhases } = useFeatures();
  const [activeTask, setActiveTask] = useState<string>("");

  const totals = useMemo(() => {
    const tasks = (todoPhases ?? []).flatMap((phase) => phase.tasks);
    const done = tasks.filter((task) => task.status === "completed").length;
    return { done, total: tasks.length };
  }, [todoPhases]);

  const menuItems = useMemo<BranchedMenuItem[]>(() => {
    return (todoPhases ?? []).map((phase, phaseIndex) => ({
      label: (
        <span className="todo-phase-head">
          <span className="todo-phase-title">{phase.name}</span>
          <span className="todo-phase-count">{phase.tasks.length}</span>
        </span>
      ),
      children: phase.tasks.map((task, taskIndex) => {
        const Icon = STATUS_ICON[task.status] ?? Circle;
        const color = STATUS_COLOR[task.status];
        const val = `${phaseIndex}-${taskIndex}-${task.content}`;
        return {
          value: val,
          icon: (
            <Icon
              size={13}
              style={{ color }}
              className={task.status === "in_progress" ? "is-spinning" : undefined}
              aria-hidden="true"
            />
          ),
          label: (
            <span
              className={`todo-task-label is-${task.status}`}
              title={task.content + (task.blocker ? ` (${task.blocker})` : "")}
            >
              <span className="todo-task-text">{task.content}</span>
              {task.blocker ? <span className="todo-task-blocker">{task.blocker}</span> : null}
            </span>
          ),
        };
      }),
    }));
  }, [todoPhases]);

  if (!todoPhases || todoPhases.length === 0) {
    return (
      <section className="feature-panel todo-panel" aria-label="To-do list">
        <header className="feature-panel-header">
          <h3>To-do</h3>
          <span className="feature-panel-hint">No tasks yet</span>
        </header>
      </section>
    );
  }

  return (
    <section className="feature-panel todo-panel" aria-label="To-do list">
      <header className="feature-panel-header">
        <h3>To-do</h3>
        <span className="feature-panel-hint">{totals.done + "/" + totals.total + " done"}</span>
      </header>
      <div className="todo-branched-wrapper">
        <BranchedMenu
          items={menuItems}
          defaultOpen={[0]}
          defaultActive={activeTask}
          onSelect={(value) => setActiveTask(value)}
          color="var(--text)"
          accentColor="var(--purple, #6c58ed)"
          lineColor="var(--line, #3f3f46)"
          width={320}
          rowHeight={30}
          indent={32}
          trunk={10}
          radius={8}
          lineWidth={1.5}
          fontSize={13}
          className="todo-branched-menu"
        />
      </div>
    </section>
  );
}

export default ToDoSidebar;
