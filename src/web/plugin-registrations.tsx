import { plugins } from './plugin-system';
import ToDoSidebar from './ToDoSidebar';
import AdvisorSidebar from './AdvisorSidebar';
import SubagentPanel from './SubagentPanel';

plugins.registerUi({ id: 'todo-sidebar', slot: 'sidebar.top', order: 5, component: ToDoSidebar });
plugins.registerUi({ id: 'advisor-sidebar', slot: 'sidebar.bottom', order: 5, component: AdvisorSidebar });
plugins.registerUi({ id: 'subagent-panel', slot: 'agent.panel', order: 30, component: SubagentPanel });
