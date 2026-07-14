/**
 * private notifications — everything soon tells the user happens HERE
 * (macos notification center) or in the approval window. operational text
 * is NEVER sent into the imessage conversation.
 */
import { Notification } from "electron";

export type NotificationAction = "review" | "stop";

export interface PrivateNotificationOptions {
  title: string;
  body?: string;
  actions?: NotificationAction[];
  onAction?: (action: NotificationAction) => void;
  onClick?: () => void;
}

const ACTION_LABEL: Record<NotificationAction, string> = {
  review: "review",
  stop: "stop",
};

export const showPrivateNotification = (options: PrivateNotificationOptions): void => {
  if (!Notification.isSupported()) return;
  const actions = options.actions ?? [];
  const notification = new Notification({
    title: options.title.toLowerCase(),
    ...(options.body !== undefined ? { body: options.body.toLowerCase() } : {}),
    silent: true,
    actions: actions.map((action) => ({ type: "button" as const, text: ACTION_LABEL[action] })),
  });
  notification.on("action", (_event, index) => {
    const action = actions[index];
    if (action !== undefined) options.onAction?.(action);
  });
  if (options.onClick !== undefined) notification.on("click", options.onClick);
  notification.show();
};
