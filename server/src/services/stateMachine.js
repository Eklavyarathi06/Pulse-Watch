export const nextState = ({ prevStatus, checkResult }) => {
  let newStatus = prevStatus;
  let shouldAlert = false;
  let alertType = null;

  if (prevStatus === 'PAUSED') {
    return { newStatus: 'PAUSED', shouldAlert: false, alertType: null };
  }

  if (checkResult === 'UP') {
    newStatus = 'UP';
    if (prevStatus === 'DOWN') {
      shouldAlert = true;
      alertType = 'RECOVERED';
    }
  } else if (checkResult === 'DOWN') {
    newStatus = 'DOWN';
    if (prevStatus === 'UP' || prevStatus === 'PENDING') {
      shouldAlert = true;
      alertType = 'DOWN';
    }
  }

  return { newStatus, shouldAlert, alertType };
};
