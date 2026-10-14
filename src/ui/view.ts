import type { App } from './app';
import { toHtml, type Line } from './grid';
import { deskScreen } from './screens/desk';
import { messagesScreen } from './screens/messages';
import { roadScreen } from './screens/road';
import { resultScreen } from './screens/result';
import { sheetsScreen } from './screens/sheets';
import { supplyScreen } from './screens/supply';

/** The lines of whichever screen the app is on. */
export function screenLines(app: App): Line[] {
  switch (app.screen) {
    case 'messages':
      return messagesScreen(app);
    case 'desk':
      return deskScreen(app);
    case 'sheets':
      return sheetsScreen(app);
    case 'road':
      return roadScreen(app);
    case 'result':
      return resultScreen(app);
    case 'supply':
      return supplyScreen(app);
  }
}

export function screenHtml(app: App): string {
  return toHtml(screenLines(app));
}
