/**
 * Human readable (Bulgarian) descriptions for the errors browsers throw from the
 * camera, geolocation and share APIs. Every message tries to say what to DO next.
 */

function mediaHint(name, message) {
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Достъпът до камерата е отказан. Разреши го от иконата до адреса (или Настройки → браузър → Камера) и презареди.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Не е намерена камера на това устройство.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Камерата е заета от друго приложение/таб. Затвори го и опитай отново.';
    case 'OverconstrainedError':
      return 'Камерата не поддържа исканата резолюция/режим. Опитай с друга камера.';
    case 'SecurityError':
      return 'Браузърът блокира камерата по съображения за сигурност. Провери, че страницата е на HTTPS.';
    case 'AbortError':
      return 'Стартирането на камерата беше прекъснато. Опитай отново.';
    default:
      return message ? `Камерата не можа да стартира: ${message}` : 'Камерата не можа да стартира.';
  }
}

export function describeMediaError(error) {
  const name = error?.name ?? '';
  const message = error?.message ?? '';
  if (!name && !message) return mediaHint('', '');
  return mediaHint(name, message);
}

export function describeGeolocationError(error) {
  const code = error?.code;
  if (code === 1 || error?.PERMISSION_DENIED === code) {
    return 'Достъпът до местоположението е отказан. Разреши Location/GPS за браузъра и презареди страницата.';
  }
  if (code === 2) {
    return 'Местоположението е недостъпно (няма GPS сигнал — опитай на открито или включи Location Services).';
  }
  if (code === 3) {
    return 'Не получихме GPS fix навреме. Изчакай малко или излез на открито място.';
  }
  return error?.message || 'Не успяхме да получим местоположението.';
}

export function describeShareError(error) {
  if (error?.name === 'AbortError') return 'Споделянето беше отказано.';
  return error?.message || 'Споделянето не е възможно на това устройство.';
}

/** Wraps an unknown thrown value into an Error with a readable message. */
export function toError(error, fallback = 'Неочаквана грешка.') {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : fallback);
}
