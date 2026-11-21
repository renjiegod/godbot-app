import './src/polyfills';
// Godbot: the FCM push task must be defined when the bundle loads, also for a headless start.
import './src/team/push-task.ts';
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
