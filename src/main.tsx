import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {syncWirdReminderFromStorage} from './lib/nativeReminders';

// مزامنة تذكير الورد اليومي (أندرويد فقط؛ لا أثر له في الويب)
syncWirdReminderFromStorage();

createRoot(document.getElementById('root')!).render(<App />);
