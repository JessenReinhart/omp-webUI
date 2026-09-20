import { CheckCircle2, Circle, CircleDashed, CircleSlash2, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { useFeatures } from "./featureStore";
import type { TodoTask } from "./featureTypes";

const STATUS_ICON: Record<TodoTask["status"], typeof Circle> = {
  pending: Circle,
  in_progress: Loader2,
  completed: CheckCircle2,
  abandoned: CircleSlash2,
  blocked: CircleDashed,
};

export function ToDoSidebar() {
  const { todoPhases } = useFeatures();
  const totals = useMemo(() => {
    const tasks = (todoPhases ?? []).flatMap((phase) => phase.tasks);
    const done = tasks.filter((task) => task.status === "completed").length;
    return { done, total: tasks.length };
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
      {todoPhases.map((phase, index) => (
        <details className="todo-phase" key={phase.name + "-" + index} open={index === 0}>
          <summary className="todo-phase-name">
            {phase.name}
            <span className="todo-phase-count">{phase.tasks.length}</span>
          </summary>
          <ul className="todo-task-list">
            {phase.tasks.map((task, taskIndex) => {
              const Icon = STATUS_ICON[task.status] ?? Circle;
              return (
                <li className={"todo-task is-" + task.status} key={task.content + "-" + taskIndex}>
                  <Icon
                    size={13}
                    className={"todo-task-icon" + (task.status === "in_progress" ? " is-spinning" : "")}
                    aria-hidden="true"
                  />
                  <span className="todo-task-content" title={task.content}>{task.content}</span>
                  {task.blocker ? <span className="todo-task-blocker" title={task.blocker}>blocked</span> : null}
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </section>
  );
}

export default ToDoSidebar;
