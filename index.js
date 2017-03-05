'use strict';

const qiniu = require('qiniu');
const path = require('path');
const ora = require('ora');
const isRegExp = require('lodash.isregexp');

// Contants
const REGEXP_HASH = /\[hash(?::(\d+))?\]/gi;

// Uploading progress tip
const tip = (uploaded, total) => {
  let percentage = Math.round(uploaded / total * 100);
  return `Uploading to Qiniu CDN: ${percentage}% ${uploaded}/${total} files uploaded`;
};

// Replace path variable by hash with length
const withHashLength = (replacer) => {
  return function(_, hashLength) {
    const length = hashLength && parseInt(hashLength, 10);
    const hash = replacer.apply(this, arguments);
    return length ? hash.slice(0, length) : hash;
  };
};

// Perform hash replacement
const getReplacer = (value, allowEmpty) => {
  return function(match) {
    // last argument in replacer is the entire input string
    const input = arguments[arguments.length - 1];
    if(value === null || value === undefined) {
      if(!allowEmpty) throw new Error(`Path variable ${match} not implemented in this context of qn-webpack plugin: ${input}`);
      return '';
    } else {
      return `${value}`;
    }
  };
};

module.exports = class QiniuPlugin {
  constructor(options) {
    this.options = Object.assign({}, options);
    qiniu.conf.ACCESS_KEY = this.options.accessKey;
    qiniu.conf.SECRET_KEY = this.options.secretKey;
    qiniu.conf.AUTOZONE = options.autoZone !== false;
  }

  apply(compiler) {
    compiler.plugin('after-emit', (compilation, callback) => {

      let assets = compilation.assets;
      let hash = compilation.hash;
      let bucket = this.options.bucket;
      let uploadPath = this.options.path || '[hash]';
      let exclude = isRegExp(this.options.exclude) && this.options.exclude;
      let include = isRegExp(this.options.include) && this.options.include;

      uploadPath = uploadPath.replace(REGEXP_HASH, withHashLength(getReplacer(hash)));

      let filesNames = Object.keys(assets);
      let totalFiles = 0;
      let uploadedFiles = 0;
      let promises = [];

      // Mark finished
      let _finish = (err) => {
        spinner.succeed();
        // eslint-disable-next-line no-console
        console.log('\n');
        callback(err);
      };

      // Filter files that should be uploaded to Qiniu CDN
      filesNames = filesNames.filter(fileName => {
        let file = assets[fileName] || {};

        // Ignore unemitted files
        if (!file.emitted) return false;

        // Check excluced files
        if (exclude && exclude.test(fileName)) return false;

        // Check included files
        if (include) return include.test(fileName);

        return true;
      });

      totalFiles = filesNames.length;

      // eslint-disable-next-line no-console
      console.log('\n');
      let spinner = ora({
        text: tip(0, totalFiles),
        color: 'green'
      }).start();

      filesNames.map(fileName => {
        let file = assets[fileName] || {};

        let key = path.posix.join(uploadPath, fileName);
        let token = new qiniu.rs.PutPolicy(`${bucket}:${key}`).token();
        let extra = new qiniu.io.PutExtra();

        let promise = new Promise((resolve, reject) => {
          let begin = Date.now();
          qiniu.io.putFile(token, key, file.existsAt, extra, function (err, ret) {

            uploadedFiles++;
            spinner.text = tip(uploadedFiles, totalFiles);

            if (err) return reject(err);
            ret.duration = Date.now() - begin;
            resolve(ret);
          });
        });

        promises.push(promise);
      });

      Promise.all(promises).then(() => _finish()).catch(_finish);
    });
  }
};
