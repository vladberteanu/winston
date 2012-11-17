/*
 * common.js: Internal helper and utility functions for winston
 *
 * (C) 2010 Charlie Robbins
 * MIT LICENCE
 *
 */

var util = require('util'),
    crypto = require('crypto'),
    cycle = require('cycle'),
    config = require('./config');

//
// ### function setLevels (target, past, current)
// #### @target {Object} Object on which to set levels.
// #### @past {Object} Previous levels set on target.
// #### @current {Object} Current levels to set on target.
// Create functions on the target objects for each level
// in current.levels. If past is defined, remove functions
// for each of those levels.
//
exports.setLevels = function (target, past, current, isDefault) {
  if (past) {
    Object.keys(past).forEach(function (level) {
      delete target[level];
    });
  }

  target.levels = current || config.npm.levels;
  if (target.padLevels) {
    target.levelLength = exports.longestElement(Object.keys(target.levels));
  }

  //
  //  Define prototype methods for each log level
  //  e.g. target.log('info', msg) <=> target.info(msg)
  //
  Object.keys(target.levels).forEach(function (level) {
    target[level] = function (msg) {
      var args = Array.prototype.slice.call(arguments, 1),
          callback = args.pop(),
          meta = args;

      if (typeof callback !== 'function') {
        meta.push(callback);
        callback = null;
      }

      meta = (meta.length <= 1 && meta.shift()) || meta;

      return target.log(level, msg, meta, callback);
    };
  });

  return target;
};

//
// ### function longestElement
// #### @xs {Array} Array to calculate against
// Returns the longest element in the `xs` array.
//
exports.longestElement = function (xs) {
  return Math.max.apply(
    null,
    xs.map(function (x) { return x.length; })
  );
};

//
// ### function clone (obj)
// #### @obj {Object} Object to clone.
// Helper method for deep cloning pure JSON objects
// i.e. JSON objects that are either literals or objects (no Arrays, etc)
//
exports.clone = function (obj) {
  // we only need to clone refrence types (Object)
  if (!(obj instanceof Object)) {
    return obj;
  }
  else if (obj instanceof Date) {
    return obj;
  }

  var copy = {};
  for (var i in obj) {
    if (Array.isArray(obj[i])) {
      copy[i] = obj[i].slice(0);
    }
    else if (obj[i] instanceof Buffer) {
        copy[i] = obj[i].slice(0);
    }
    else if (typeof obj[i] != 'function') {
      copy[i] = obj[i] instanceof Object ? exports.clone(obj[i]) : obj[i];
    }
    else if (typeof obj[i] === 'function') {
      copy[i] = obj[i];
    }
  }

  return copy;
};

//
// ### function log (options)
// #### @options {Object} All information about the log serialization.
// Generic logging function for returning timestamped strings
// with the following options:
//
//    {
//      level:     'level to add to serialized message',
//      message:   'message to serialize',
//      meta:      'additional logging metadata to serialize',
//      colorize:  false, // Colorizes output (only if `.json` is false)
//      timestamp: true   // Adds a timestamp to the serialized message
//    }
//
exports.log = function (options) {
  var timestampFn = typeof options.timestamp === 'function'
                  ? options.timestamp
                  : exports.timestamp,
      timestamp   = options.timestamp ? timestampFn() : null,
      meta        = options.meta !== undefined || options.meta !== null ? exports.clone(cycle.decycle(options.meta)) : null,
      output;
  //
  // raw mode is intended for outputing winston as streaming JSON to STDOUT
  //
  if (options.raw) {
    if (typeof meta !== 'object' && meta != null) {
      meta = { meta: meta };
    }
    output         = exports.clone(meta) || {};
    output.level   = options.level;
    output.message = options.message.stripColors;
    return JSON.stringify(output);
  }

  //
  // json mode is intended for pretty printing multi-line json to the terminal
  //
  if (options.json) {
    if (typeof meta !== 'object' && meta != null) {
      meta = { meta: meta };
    }

    output         = exports.clone(meta) || {};
    output.level   = options.level;
    output.message = options.message;

    if (timestamp) {
      output.timestamp = timestamp;
    }

    if (typeof options.stringify === 'function') {
      return options.stringify(output);
    }

    return JSON.stringify(output, function (key, value) {
      return value instanceof Buffer
        ? value.toString('base64')
        : value;
    });
  }
  if (options.timestamp_format) {
    timestamp = get_timestamp(options.timestamp_format);
  }
  output = timestamp ? timestamp + ': ' : '';
  output += options.show_filename ? get_filename(__filename) + ': ' : '';
  output += options.colorize ? config.colorize(options.level) : options.level;
  output += (': ' + options.message);

  if (meta !== null && meta !== undefined) {
    if (typeof meta !== 'object') {
      output += ' ' + meta;
    }
    else if (Object.keys(meta).length > 0) {
      output += ' ' + (options.prettyPrint ? ('\n' + util.inspect(meta, false, null, options.colorize)) : exports.serialize(meta));
    }
  }

  return output;
};

exports.capitalize = function (str) {
  return str && str[0].toUpperCase() + str.slice(1);
};

function get_filename(path) {
  var dirs = path.split('/');
  return dirs[dirs.length - 1];
}

function get_timestamp(format) {
  var time = new Date(),
      year = time.getFullYear(),
      month = time.getMonth(),
      day = time.getDate(),
      h = time.getHours(),
      m = time.getMinutes(),
      s = time.getSeconds();
  if (format === 'local_time') {
    return year + '-' + month + '-' + day + ' ' + h + ':' + m + ':' + s;
  }
}

//
// ### function hash (str)
// #### @str {string} String to hash.
// Utility function for creating unique ids
// e.g. Profiling incoming HTTP requests on the same tick
//
exports.hash = function (str) {
  return crypto.createHash('sha1').update(str).digest('hex');
};

//
// ### function pad (n)
// Returns a padded string if `n < 10`.
//
exports.pad = function (n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
};

//
// ### function timestamp ()
// Returns a timestamp string for the current time.
//
exports.timestamp = function () {
  return new Date().toISOString();
};

//
// ### function serialize (obj, key)
// #### @obj {Object|literal} Object to serialize
// #### @key {string} **Optional** Optional key represented by obj in a larger object
// Performs simple comma-separated, `key=value` serialization for Loggly when
// logging to non-JSON inputs.
//
exports.serialize = function (obj, key) {
  if (obj === null) {
    obj = 'null';
  }
  else if (obj === undefined) {
    obj = 'undefined';
  }
  else if (obj === false) {
    obj = 'false';
  }

  if (typeof obj !== 'object') {
    return key ? key + '=' + obj : obj;
  }

  if (obj instanceof Buffer) {
    return key ? key + '=' + obj.toString('base64') : obj.toString('base64');
  }

  var msg = '',
      keys = Object.keys(obj),
      length = keys.length;

  for (var i = 0; i < length; i++) {
    if (Array.isArray(obj[keys[i]])) {
      msg += keys[i] + '=[';

      for (var j = 0, l = obj[keys[i]].length; j < l; j++) {
        msg += exports.serialize(obj[keys[i]][j]);
        if (j < l - 1) {
          msg += ', ';
        }
      }

      msg += ']';
    }
    else if (obj[keys[i]] instanceof Date) {
      msg += keys[i] + '=' + obj[keys[i]];
    }
    else {
      msg += exports.serialize(obj[keys[i]], keys[i]);
    }

    if (i < length - 1) {
      msg += ', ';
    }
  }

  return msg;
};

//
// ### function format (arr)
// #### @arr {Array} The array that contains all parts of the message
// similar to util.format
// returns the formated string
// uses the original array and removes items as it proceeds
//
exports.format = function (arr) {
  var msg = arr.shift();

  if (typeof msg !== "string") {
    return msg;
  }

  return msg.replace(/%[sdj%]/g, function (x){
    switch (x.charAt(1)) {
      case "j": return JSON.stringify(arr.shift());
      case "s": return String(arr.shift());
      case "d": return Number(arr.shift());
      case "%": return "%";
      default:  return x;
    }
  });
};
