// C25K Service Worker
const CACHE_NAME = 'c25k-app-v1';
const ASSETS = [
  '/C25K/index.html',
  '/C25K/main.js',
  '/C25K/main.css',
  '/C25K/favicon.ico',
  '/C25K/manifest.json'
];

// Timer state
let timerInterval = null;
let workoutState = {
  isRunning: false,
  timeRemaining: 0,
  totalTime: 0,
  elapsedTime: 0,
  currentPhase: null,
  currentPhaseIndex: 0,
  schedule: [],
  startTime: null
};

// Format time (convert seconds to MM:SS)
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Install event - cache assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache if available
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

// Start the workout timer
function startWorkoutTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  workoutState.startTime = Date.now();
  
  timerInterval = setInterval(() => {
    if (!workoutState.isRunning) return;
    
    // Calculate elapsed time based on real time
    const currentTime = Date.now();
    const secondsElapsed = Math.floor((currentTime - workoutState.startTime) / 1000);
    
    // Update elapsed time and time remaining
    workoutState.elapsedTime = secondsElapsed;
    const currentPhaseElapsed = secondsElapsed - workoutState.phaseStartTime;
    workoutState.timeRemaining = Math.max(0, workoutState.currentPhase.duration - currentPhaseElapsed);
    
    // Check if phase is completed
    if (workoutState.timeRemaining <= 0) {
      // Move to next phase
      workoutState.currentPhaseIndex++;
      
      // Check if workout is completed
      if (workoutState.currentPhaseIndex >= workoutState.schedule.length) {
        completeWorkout();
        return;
      }
      
      // Start next phase
      startNextPhase();
    }
    
    // Notify clients about timer update
    notifyClients('TIMER_UPDATE', {
      timeRemaining: workoutState.timeRemaining,
      elapsedTime: workoutState.elapsedTime,
      currentPhaseIndex: workoutState.currentPhaseIndex,
      progress: (workoutState.elapsedTime / workoutState.totalTime) * 100
    });
    
    // If countdown is active (5 seconds or less), notify for countdown
    if (workoutState.timeRemaining <= 5 && workoutState.timeRemaining > 0) {
      notifyClients('COUNTDOWN', {
        timeRemaining: workoutState.timeRemaining,
        nextPhaseIndex: workoutState.currentPhaseIndex + 1 < workoutState.schedule.length ? 
                        workoutState.currentPhaseIndex + 1 : null
      });
    }
  }, 1000);
}

// Start the next phase
function startNextPhase() {
  workoutState.currentPhase = workoutState.schedule[workoutState.currentPhaseIndex];
  workoutState.phaseStartTime = workoutState.elapsedTime;
  workoutState.timeRemaining = workoutState.currentPhase.duration;
  
  // Notify about phase change
  notifyClients('PHASE_CHANGE', {
    phase: workoutState.currentPhase,
    phaseIndex: workoutState.currentPhaseIndex
  });
  
  // Send notification for phase change
  self.registration.showNotification(`${workoutState.currentPhase.name} Phase`, {
    body: `Next up: ${workoutState.currentPhase.type.toUpperCase()}`,
    icon: 'favicon.ico',
    badge: 'favicon.ico',
    tag: 'c25k-phase-change',
    vibrate: [200, 100, 200]
  });
}

// Complete the workout
function completeWorkout() {
  workoutState.isRunning = false;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  // Notify clients that workout is complete
  notifyClients('WORKOUT_COMPLETE', {});
  
  // Send completion notification
  self.registration.showNotification('Workout Complete!', {
    body: 'Congratulations! You have finished your workout.',
    icon: 'favicon.ico',
    badge: 'favicon.ico',
    tag: 'c25k-workout-complete',
    vibrate: [200, 100, 200, 100, 200]
  });
}

// Stop the workout
function stopWorkout() {
  workoutState.isRunning = false;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  // Notify clients
  notifyClients('WORKOUT_STOPPED', {});
}

// Reset the workout
function resetWorkout() {
  workoutState.isRunning = false;
  workoutState.timeRemaining = 0;
  workoutState.elapsedTime = 0;
  workoutState.currentPhaseIndex = 0;
  workoutState.currentPhase = null;
  
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  // Notify clients
  notifyClients('WORKOUT_RESET', {});
}

// Notify all clients
function notifyClients(type, data) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: type,
        data: data
      });
    });
  });
}

// Handle notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  // This looks for an open window and focuses it
  event.waitUntil(
    clients.matchAll({
      type: "window"
    })
    .then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/index.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/C25K/index.html');
      }
    })
  );
});

// Listen for messages from the main thread
self.addEventListener('message', event => {
  if (!event.data) return;
  
  switch (event.data.type) {
    case 'SHOW_NOTIFICATION':
      const { title, options } = event.data;
      self.registration.showNotification(title, options);
      break;
      
    case 'START_WORKOUT':
      workoutState = {
        ...workoutState,
        isRunning: true,
        timeRemaining: event.data.timeRemaining || 0,
        totalTime: event.data.totalTime || 0,
        elapsedTime: event.data.elapsedTime || 0,
        currentPhaseIndex: event.data.currentPhaseIndex || 0,
        schedule: event.data.schedule || [],
        currentPhase: event.data.currentPhase || null,
        phaseStartTime: event.data.elapsedTime || 0
      };
      startWorkoutTimer();
      break;
      
    case 'STOP_WORKOUT':
      stopWorkout();
      break;
      
    case 'RESET_WORKOUT':
      resetWorkout();
      break;
      
    case 'SYNC_STATE':
      // For when the page reloads or reconnects
      if (workoutState.isRunning) {
        // Send current state back to client
        if (event.source) {
          event.source.postMessage({
            type: 'WORKOUT_STATE_SYNC',
            data: workoutState
          });
        }
      }
      break;
  }
}); 