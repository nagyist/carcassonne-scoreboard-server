const io = require('socket.io');
const guid = require('./guid');

// database
const mongo = require('./mongo');

// configuration
const config = require('../config/config.json');

// global variables
let users = {
  active: [],
  connected: [],
  disconnected: []
};

module.exports = {
  start: function(fileserver) {
    // start listening for new users connected
    io.listen(fileserver).on('connection', handler);
  }
}

/**
 * Make sure all the users are still online
 * if not, remove them from the users.connected array and notify
 * the users with the updated users.connected value on the home page
 */
function updateUsers(socket) {
  var index = null;
  var match = [];
  var divergences = false;

  for ( index in users.active ) {
    if ( users.connected.indexOf( users.active[index] ) === -1 ) {
      if ( users.disconnected.indexOf(users.active[index]) !== -1 ) {
        // user is really disconnected, removing it...
        users.active.splice( users.active.indexOf(users.active[index]), 1 );
        users.disconnected.splice( users.active.indexOf(users.active[index]), 1 );
      }
      else {
        // send a ping to the user to see if the missing user is still alive somewhere
        users.disconnected.push(users.active[index]);
        socket.sockets.emit('ping', users.active[index]);
        divergences = true;
      }
    }
  }

  // offline users will be removed after 30 seconds if they don't send
  // a 'pong' back before that time
  if (divergences) {
    setTimeout(() => updateUsers(socket), 3000 );
  }

  // spread the updated online users to the conneted clients
  socket.sockets.emit('app:update', {
    users: users.active.length,
    games: Object.keys(config.games).length
  });
}

// start listening for new users connected
function handler(socket) {
  let uid = null;
  let registered = false;

  // send the new user the number of online users so far
  socket.emit('app:update', {
    users: users.active.length,
    games: Object.keys(config.games).length
  });

  // welcome the new user
  socket.emit('init', true);

  // register the new user
  socket.on('register', function(user_uid) {
    if (!user_uid ) {
      socket.emit('user:failed', true);
    }

    registered = true;
    uid = user_uid;

    if (users.connected.indexOf(uid) < 0) {
      users.connected.push(uid);
    }

    if (users.active.indexOf(uid) < 0) {
      users.active.push(uid);
    }

    // spread the updated online users to the conneted clients
    socket.server.sockets.emit('app:update', {
      users: users.active.length,
      games: Object.keys(config.games).length
    });
  });

  /**
   * When a user disconnect, try to ping it and see if it's still alive somewhere
   * @param  [String] user_uid   The user uid of the disconnected user
   */
  socket.on('pong', function (user_uid) {
    if (users.disconnected.indexOf(user_uid) !== -1) {
      // user is still alive
      users.connected.push(user_uid);
      users.disconnected.splice(users.disconnected.indexOf(user_uid), 1);
    }
  });

  // when a user is disconnected, make sure it's really gone.
  socket.on('disconnect', function () {
    if (users.connected.indexOf(uid) !== -1) {
      users.connected.splice(users.connected.indexOf(uid), 1);
    }

    // update the users.connected array
    updateUsers(socket.server);
  });

  //=======================
  //
  //         Game
  //
  //=======================

  // create a new game or update an existing one
  // using the information fetched from the client
  socket.on('game:start', function (data) {
    // if game_id is missing, create a new game
    const game_id = data.game_id || guid();

    let old_users;
    let user_points;
    let i;

    if (!data.game.players || data.game.players.length <= 0) {
      socket.emit('game:ready', {error: true});
      return false;
    }

    // create a new game on server side if doesn't exist
    if (!config.games[game_id]) {
      config.games[game_id] = {
        new_game: true,
        admin: uid,
        players: [],
        logs: [],
        meeples: config.game.meeples
      };
    }
    else {
      config.games[game_id].new_game = false;
      // store the user's score before updating the user's information
      old_users = Object.create(config.games[game_id].players);
    }

    // remove the previous user information and use the new ones
    config.games[game_id].players = [];

    for (i in data.game.players) {
      // limit players to the game.max_players value
      if (i >= config.game.max_players) continue;

      user_points = 0;

      if (!config.games[game_id].new_game && old_users[i] && old_users[i].score) {
        user_points = old_users[i].score;
      }

      config.games[game_id].players.push({
        name: data.game.players[i].name || 'Player',
        color: data.game.players[i].color || 'Black',
        score: user_points
      });

      mongo.syncGame(game_id);
    }

    config.games[game_id].name = data.game.name || config.game.name;
    config.games[game_id].max_players = config.game.max_players;
    config.games[game_id].meeples = config.game.meeples;

    // send back the updated information to the client
    socket.emit('game:ready', {
      game_id: game_id,
      new_game: config.games[game_id].new_game
    });

    // send new information to all the other users connected to the game
    socket.broadcast.emit('game:update', {
      game_id: game_id,
      game: config.games[game_id]
    });
  });

  // a client requested a game_id information
  // every one knowing the game uid can request this
  // send back the game, if any
  socket.on('game:get', function (game_id) {

    if (!config.games[game_id]) {
      socket.emit('game:get', {error: true});
      return;
    }

    socket.emit('game:get', {
      error: false,
      game: config.games[game_id]
    });
  });

  // update score in a game
  socket.on('game:score', function (data) {
    const currentTime = new Date();

    let hours = currentTime.getHours();
    let minutes = currentTime.getMinutes();
    let seconds = currentTime.getSeconds();

    let now;
    let log;

    if (!config.games[data.game_id] || data.points <= 0) {
      socket.server.sockets.emit('game:update', {
        game_id: data.game_id,
        error: true
      });

      return;
    }

    minutes = minutes < 10 ? '0' + minutes : minutes;
    seconds = seconds < 10 ? '0' + seconds : seconds;
    now = hours + ':' + minutes + ':' + seconds;
    log = [now];

    for (var i = 0; i < data.game.players.length; i++) {
      if (i === data.player_selected) {
        log.push('+' + data.points);
      }
      else {
        log.push('-');
      }
    }

    config.games[data.game_id].logs.push(log);
    mongo.syncLog(data.game_id);

    socket.server.sockets.emit('game:update', {
      game_id: data.game_id,
      game: config.games[data.game_id]
    });
  });

  socket.on('game:undo', function (data) {
    if (config.games[data.game_id] && config.games[data.game_id].logs.length > 0) {
      config.games[data.game_id].logs.pop();
      mongo.syncLog(data.game_id);

      socket.server.sockets.emit('game:update', {
        game_id: data.game_id,
        game: config.games[data.game_id]
      });
    }
  });
}
