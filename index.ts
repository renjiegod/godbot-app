import './src/polyfills';
// Godbot: the FCM push task must be defined when the bundle loads, also for a headless start.
import './src/team/push-task.ts';
// Godbot: so must the keep-alive task, which brings the link back with no screen up.
import './src/team/keepalive-task.ts';
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
