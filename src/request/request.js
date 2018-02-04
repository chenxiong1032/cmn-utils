import { isFunction, isObject, param } from '../utils';
import RequestError from './error';

export const REQUEST_METHODS = [
  'GET', 'POST', 'HEAD', 'DELETE', 'OPTIONS', 'PUT', 'PATCH'
];

export default class Request {
  /**
   * default options
   */
  defaultOptions = {
    method: 'POST',         // default
    mode: 'cors',
    cache: 'no-cache',
    credentials: 'include',
    headers: {
      'content-type': 'application/json'
    },
    responseType: 'json',   // text or blob or formData https://fetch.spec.whatwg.org/
    prefix: '',             // request prefix
    beforeRequest: null,    // before request check, return false or a rejected Promise will stop request
    afterResponse: null,    // after request hook
    errorHandle: null,      // global error handle
  }

  constructor(opts = {}) {
    this._options = {
      ...this.defaultOptions,
      ...opts
    }

    // normalize the headers
    const headers = this._options.headers;

    for (let h in headers) {
      if (h !== h.toLowerCase()) {
        headers[h.toLowerCase()] = headers[h];
        delete headers[h];
      }
    }

    REQUEST_METHODS.forEach((method) => {
      this[method.toLowerCase()] = (url, data, opts = {}) => {
        opts.data = data;
        return this.send(url, { ...opts, method });
      }
    })
  }

  create = (opts) => {
    return new Request(opts);
  }

  /**
   * Set Options
   *
   * Examples:
   *
   *   .config('method', 'GET')
   *   .config({headers: {'content-type': 'application/json'}})
   *
   * @param {String|Object} key
   * @param {Any} value
   * @return {Request}
   */
  config = (key, value) => {
    const options = this._options

    if (typeof key === 'object') {
      for (let k in key) {
        options[k] = key[k];
      }
    } else {
      options[key] = value;
    }

    return this;
  }

  prefix = (prefix) => {
    if (prefix && typeof prefix === 'string') this._options.prefix = prefix;
    return this;
  }

  beforeRequest = (cb) => {
    const options = this._options;
    if (isFunction(cb)) {
      options.beforeRequest = cb;
    }
    return this;
  }

  afterResponse = (cb) => {
    const options = this._options;
    if (isFunction(cb)) {
      options.afterResponse = cb;
    }
    return this;
  }

  errorHandle = (cb) => {
    const options = this._options;
    if (isFunction(cb)) {
      options.errorHandle = cb;
    }
    return this;
  }

  /**
   * Set headers
   *
   * Examples:
   *
   *   .headers('Accept', 'application/json')
   *   .headers({ Accept: 'application/json' })
   *
   * @param {String|Object} key
   * @param {String} value
   * @return {Request}
   */
  headers = (key, value) => {
    const { headers } = this._options;

    if (isObject(key)) {
      for (let k in key) {
        headers[k.toLowerCase()] = key[k];
      }
    } else if (isFunction(key)) {
      headers.__headersFun__ = key;
    } else {
      headers[key.toLowerCase()] = value;
    }

    return this;
  }

  /**
   * Set Content-Type
   *
   * @param {String} type
   */
  contentType = (type) => {
    const { headers } = this._options;

    switch (type) {
      case 'json':
        type = 'application/json';
        break;
      case 'form':
      case 'urlencoded':
        type = 'application/x-www-form-urlencoded;charset=UTF-8';
        break;
      case 'multipart':
        type = 'multipart/form-data';
        break;
    }

    headers['content-type'] = type;
    return this;
  }

  _data = (data, contentType) => {
    let body = null;

    // if FormData
    if (contentType.indexOf('multipart/form-data') !== -1) {
      body = new FormData();

      if (data instanceof FormData) {
        body = data;
        return body;
      }

      if (typeof data === 'object') {
        for (let k in data) {
          body.append(k, data[k]);
        }
      }
    } else {
      if (body && typeof data === 'object') {
        for (let key in data) {
          body[key] = data[key]
        }
      } else {
        body = data
      }
    }

    return body;
  }

  /**
   * GET send form
   */
  getform = (url, opts = {}) => {
    return this.send(url, {
      ...opts,
      method: 'GET',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
      }
    })
  }

  /**
   * POST send form
   */
  postform = (url, opts = {}) => {
    return this.send(url, {
      ...opts,
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
      }
    })
  }

  // send request
  send = (url, opts = {}) => new Promise((resolve, reject) => {
    if (typeof url !== 'string') {
      return reject(new RequestError('invalid url', 'invalidURL'));
    }

    const { data, ...otherOpts } = opts;

    const options = { ...this._options, ...otherOpts };

    const { beforeRequest, afterResponse, errorHandle, responseType, prefix, headers, ...fetchOpts } = options;

    const { __headersFun__, ...realheaders } = headers;
    let newheaders = { ...realheaders };
    if (__headersFun__) {
      const _newheaders = __headersFun__();
      if (_newheaders && isObject(_newheaders)) {
        newheaders = { ...realheaders, ..._newheaders };
      }
    }

    const contentType = newheaders['content-type'];

    const body = this._data(data, contentType);

    if (contentType.indexOf('application/json') !== -1) {
      fetchOpts.body = JSON.stringify(body);
    } else if (contentType.indexOf('application/x-www-form-urlencoded') !== -1) {
      fetchOpts.body = param(body);
    } else {
      fetchOpts.body = body;
    }

    // if 'GET' request, join _body of url queryString
    if (fetchOpts.method.toUpperCase() === 'GET' && body) {
      if (url.indexOf('?') >= 0) {
        url += '&' + param(body);
      } else {
        url += '?' + param(body);
      }
      delete fetchOpts.body;
    }

    if (isFunction(beforeRequest) && beforeRequest(url, options) === false) {
      return reject(new RequestError('request canceled by beforeRequest', 'requestCanceled'));
    }

    return fetch(prefix + url, { headers: newheaders, ...fetchOpts })
      .then(resp => this.__checkStatus(resp))
      .then(resp => this.__parseResponse(resp, responseType))
      .then(resp => this.__afterResponse(resp, afterResponse))
      .then(response => resolve(response))
      .catch(e => this.__errorHandle(e, errorHandle, reject));
  })

  __checkStatus(response) {
    if (response.status >= 200 && response.status < 300) {
      if (response.status == 204) {
        return null;
      }
      return response;
    }
    const errortext = response.statusText;
    const error = new RequestError(errortext, response.status);
    error.response = response;
    throw error;
  }

  __parseResponse(response, responseType) {
    return isFunction(response && response[responseType]) ? response[responseType]() : response;
  }

  __afterResponse(response, afterResponse) {
    if (isFunction(afterResponse)) {
      const after = afterResponse(response);
      if (after && after.then) {
        after.then(afterResp => {
          return afterResp;
        })
      } else {
        return after
      }
    } else {
      return response;
    }
  }

  __errorHandle(e, errorHandle, reject) {
    if (e.name !== 'RequestError') {
      e.name = 'RequestError';
      e.code = 0;
    }
    if (!isFunction(errorHandle) || errorHandle(e) !== false) {
      reject(e);
    }
  }
}