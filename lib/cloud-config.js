var async = require('async'),
    config = require('./template/basic-config.json'),
    fs = require('fs'),
    path = require('path'),
    monitoringTemplate = require('./template/rackspace-monitoring-units.json'),
    yaml = require('js-yaml'),
    _ = require('lodash');

var filePaths = [
  'fixup-etc.sh',
  'rackspace-ips.sh',
  'rackspace-monitoring-agent.service',
  'rackspace-monitoring-agent-id.service',
  'rackspace-monitoring-agent-token.service',
  'rackspace-ip-environment.service'];

var files = {
  loaded: false
};

exports.getCloudConfig = function(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  ['region', 'discoveryServiceUrl'].forEach(function(option) {
    if (!options[option]) {
      throw new Error('Missing required options: ' + option);
    }
  });

  // default to base64 encoding
  options.encoding = options.encoding || 'base64';

  if (!files.loaded) {
    async.each(filePaths, function(filePath, next) {
      fs.readFile(path.resolve(__dirname, './template/') + '/' + filePath, function(err, file) {
        if (err) {
          next(err);
          return;
        }

        files[filePath] = file.toString();
        next();
      });
    }, function(err) {
      if (err) {
        callback(err);
        return;
      }

      files.loaded = true;
      buildTemplate();
    });

    return;
  }

  function buildTemplate() {
    var template = _.cloneDeep(config);

    template.coreos.etcd.discovery = options.discoveryServiceUrl;
    template.coreos.fleet.metadata = 'provider=rackspace,region=' + options.region;
    
    // CoreOS update settings
    if (options.update) {
      // The update group. Can be "master", "stable", "alpha", or a
      // UUID for a custom group
      if (options.update.group) {
          template.coreos.update.group = options.update.group;
      }
      
      // The omaha endpoint URL which will be queried for updates.
      if (options.update.server) {
          template.coreos.update.server = options.update.server;
      }

    }

    if (options.monitoringToken) {
      template.coreos.units = template.coreos.units.concat(_.cloneDeep(monitoringTemplate));
    }

    _.each(template.coreos.units, function(unit) {
      if (files[unit.name]) {
        unit.content = files[unit.name].replace('RACKSPACE_MONITORING_TOKEN', options.monitoringToken);
      }
    });

    _.each(template.write_files, function(file) {
      if (files[path.basename(file.path)]) {
        file.content = files[path.basename(file.path)];
      }
    });

    if (options.privateNetwork) {
      _.each(template.write_files, function(file) {
        if (path.basename(file.path)) {
          file.content = file.content.replace(/RAX_SERVICENET_IPV4/gi, 'RAX_PRIVATENET_IPV4');
        }
      });
    }

    var file = new Buffer('#cloud-config\n\n' + yaml.dump(template)).toString();

    // HACK: this is because value: true doesn't serialize to value: yes but rather value: "yes"
    file = file.replace(/runtime: \"yes\"/gi,'runtime: yes');

    callback(null, new Buffer(file).toString(options.encoding));
  }

  buildTemplate();
};
