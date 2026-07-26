const DEBUG_ASSIGNMENT = (process.env.DEBUG_ASSIGNMENT || 'false').toLowerCase() === 'true';

function isDebugAssignmentEnabled() {
  return DEBUG_ASSIGNMENT;
}

function logAssignment() {
  return null;
}

function logAssignmentSuccess(ticketId, engineerName, engineerLevel, source, workload) {
  console.log(`[ASSIGNMENT SUCCESS]`);
  console.log(`Ticket: ${ticketId}`);
  console.log(`Engineer: ${engineerName}`);
  console.log(`Level: ${engineerLevel}`);
  console.log(`Workload: ${workload}`);
  if (source) {
    console.log(`Source: ${source}`);
  }
}

function logAssignmentFailed(ticketId, reason) {
  if (isDebugAssignmentEnabled()) {
    console.log(`[ASSIGNMENT FAILED] Ticket ${ticketId} Reason: ${reason}`);
  }
}

function logServer(message) {
  console.log(message);
}

function logWorker(message) {
  console.log(message);
}

function logDebugAssignment(message) {
  if (isDebugAssignmentEnabled()) {
    console.log(`[DEBUG] ${message}`);
  }
}

function logMlPrediction(payload) {
  console.log('ML Prediction:', JSON.stringify(payload, null, 2));
}

function logAssignmentDecision(payload) {
  console.log('Assignment Decision:', JSON.stringify(payload, null, 2));
}

function logError(message) {
  console.error(`[ERROR] ${message}`);
}

module.exports = {
  isDebugAssignmentEnabled,
  logAssignment,
  logAssignmentSuccess,
  logAssignmentFailed,
  logServer,
  logWorker,
  logDebugAssignment,
  logMlPrediction,
  logAssignmentDecision,
  logError,
};
