#!/usr/bin/env node
var express = require('express');
var request = require('request');
var Transform = require('stream').Transform;
var cookieParser = require('cookie-parser');
var tough = require('tough-cookie');
var Cookie = tough.Cookie;
var _ = require('lodash');
var path = require('path');
var cli = require('commander');
var app = express();
var colors = require('colors');
var bodyParser = require('body-parser');
var package = require('./package.json');

var list = function(list){
  return list.split(',').filter(function(item){ return item.length > 0});
};

var transformResponse = function(transform, proxyUrl){
  var parser = new Transform();
  parser._transform = function(data, encoding, done) {
    this.push(transform(data, encoding));
    done();
  };
  return parser;
}

var stripProtocol = function(url){
  return url.replace(/.+\:\/\//, '');
}

var replaceUrl = function(body, url, replacementUrl){
  return body.toString().replace(url, replacementUrl);
};

cli
  .version(package.version)
  .option('-u --url [url]', 'Set url of proxy (required)', stripProtocol)
  .option('-p --port [port]', 'Set port of local server', 3000)
  .option('-P --protocol [protocol]', 'Protocol to use for proxy', 'https')
  .option('-f --folders <folders>', 'Add a list of folders', list)
  .option('-v --verbose', 'Set logger to be verbose')
  .parse(process.argv);

if(!module.parent){
  staticProxy(cli.url, cli.port, cli.protocol, cli.folders, cli.verbose);
}

function staticProxy(proxyUrl, port, protocol, staticFolders, verbose, transform){
  if(proxyUrl === undefined){
    console.log(colors.red('Error: a url for the proxy must be defined\n') +
             colors.yellow('Define a proxy-url Like this: \n' +
                           'static-proxy -u google.com'));
    return ;
  }

  if (verbose === undefined){
    verbose = false;
  }

  if (transform === undefined){
    // No-op by default
    transform = function(data){ return data; }
  }

  if (port === undefined){
    port = 3000;
  }

  if (protocol === undefined){
    protocol = 'https';
  }

  if (staticFolders === undefined){
    staticFolders = ['public'];
  }

  app.use(cookieParser());
  app.use(bodyParser.json());
  staticFolders.forEach(function(folder){
    app.use(express.static(folder));
  });
  app.use(bodyParser.urlencoded({
    extended: true
  }));

  var makeUrl = function(url){
    return protocol + '://' + path.join(proxyUrl, url);
  };

  var j = request.jar();

  var makeRequest = function(req, res, next){
    if(verbose === true){
      console.log(colors.yellow('Requesting url >> ', makeUrl(req.url)));
    }
    // assign cookies to cookiejar
    _.forEach(req.cookies, function(value, key){
      j.setCookie(key + '=' + value, proxyUrl);
    });

    var pipe = false

    var isText = false;


    var headers = _.mapValues(req.headers, function(value, key){
      if (key === 'host'){
        if (_.isString(value)){
          value = value.replace(/localhost/gi, proxyUrl);
        }else if (_.isArray(value)){
          value = value.map(function(val){ return val.replace(/localhost/gi, proxyUrl); });
        }
      }
      return value;
    });

    request({
      method: req.method,
      jar: j,
      headers: {'x-csrf-token': req.headers['x-csrf-token']},
      uri: makeUrl(req.url),
      form: req.body
    })
    .on('response', function(response){
      response.headers = _.mapValues(response.headers, function(value, key){
        if (key === 'set-cookie' || key === 'location'){
          if (_.isString(value)){
            value = value.replace(proxyUrl, 'localhost:'+ port);
            value = value.replace('https', 'http');
          }else if (_.isArray(value)){
            value = value.map(function(val){ return val.replace(proxyUrl, 'localhost:'+ port); });
          }
        }
        return value;
      });

      res.writeHead(response.statusCode, response.headers)
      if(verbose === true){
        console.log(colors.green('Successfully requested >> ', makeUrl(req.url)));
      }
    })
    .pipe(transformResponse(transform))
    .pipe(res);
  };

  app.get('/*', makeRequest);
  app.post('/*', makeRequest);
  app.put('/*', makeRequest);


  var server = app.listen(port, function () {
    var host = server.address().address;
    if(host === '::') host = '0.0.0.0'
    var port = server.address().port;

    console.log(colors.green('static-proxy listening at http://%s:%s'), host, port);
  });
};

module.exports = staticProxy;
