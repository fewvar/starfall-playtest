import { torDistance } from '../world/torus.js';
import { navigationCapabilities } from './location-policy.js';

/** Радиус, на котором метка считается достигнутой, в мировых единицах. */
export const WAYPOINT_ARRIVAL_RADIUS = 120;

/**
 * Расстояния в мире хранятся в мелких единицах. На навигационных экранах
 * показываем их в тысячах с одной цифрой после запятой: 36.4 вместо 36489.
 */
export const formatNavigationDistance = (distance) =>
  (Math.floor(Math.max(0, distance) / 100) / 10).toFixed(1);

/** Снимает метку, когда корабль действительно до неё долетел. */
export function clearWaypointOnArrival(game) {
  if (!navigationCapabilities(game).waypoint) return false;
  const waypoint = game.run.waypoint;
  if (!waypoint) return false;
  const distance = torDistance(game.player.x, game.player.y, waypoint.x, waypoint.y);
  if (distance > WAYPOINT_ARRIVAL_RADIUS) return false;
  game.run.waypoint = null;
  return true;
}
