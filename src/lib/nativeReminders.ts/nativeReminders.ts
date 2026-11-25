// تذكير يومي بالورد عبر إشعارات أندرويد المحلية (Capacitor).
// يعمل فقط داخل تطبيق أندرويد، ولا يغيّر شيئاً في نسخة الويب.
// يقرأ إعداد تذكير الختمة المحفوظ في localStorage (sadiq:state:v1)
// ويجدول إشعاراً يومياً متكرراً في الوقت الذي اختاره المستخدم،
// أو يلغيه عند تعطيل التذكير. يُستدعى عند كل تشغيل للتطبيق،
// فيُحدَّث التذكير المجدول كلما غيّر المستخدم الوقت أو فعّله.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const NOTIFICATION_ID = 1;
const STORAGE_KEY = 'sadiq:state:v1';

export async function syncWirdReminderFromStorage(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw) as {
      khatma?: { reminderEnabled?: boolean; reminderTime?: string };
    };
    const enabled = state.khatma?.reminderEnabled === true;
    const time = state.khatma?.reminderTime ?? '08:00';
    await syncWirdReminder(enabled, time);
  } catch {
    // التذكير ميزة إضافية؛ تجاهل الأخطاء حتى لا يمنع تشغيل التطبيق
  }
}

export async function syncWirdReminder(enabled: boolean, time: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.some((n) => n.id === NOTIFICATION_ID)) {
      await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] });
    }
    if (!enabled) return;
    const [hour, minute] = time.split(':').map((v) => Number(v) || 0);
    const permission = await LocalNotifications.requestPermissions();
    if (permission.display !== 'granted') return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: NOTIFICATION_ID,
          title: 'صديق المسلم',
          body: 'حان وقت وردك اليومي من القرآن الكريم',
          schedule: {
            on: { hour, minute },
            every: 'day',
            allowWhileIdle: true,
          },
        },
      ],
    });
  } catch {
    // تجاهل أخطاء الإشعارات
  }
}
