/*!
 * ZRender, a high performance 2d drawing library.
 *
 * Copyright (c) 2013, Baidu Inc.
 * All rights reserved.
 *
 * LICENSE
 * https://github.com/ecomfe/zrender/blob/master/LICENSE.txt
 */
define(function(require) {
    var util = require('./core/util');
    var log = require('./core/log');
    var guid = require('./core/guid');
    var env = require('./core/env');

    var Handler = require('./Handler');
    var Storage = require('./Storage');
    var Animation = require('./animation/Animation');

    var useVML = ! env.canvasSupported;

    var Painter;
    var SVGPainter;
    if (useVML) {
        Painter = SVGPainter = require('./vml/Painter');
        require('./vml/graphic');
    }
    else {
        Painter = require('./Painter');
        SVGPainter = require('./svg/Painter');
    }

    var _instances = {};    // ZRender实例map索引

    var zrender = {};
    /**
     * @type {string}
     */
    zrender.version = '2.0.8';

    /**
     * 创建zrender实例
     *
     * @param {HTMLElement} dom
     * @param {Object} opts
     * @param {string} [opts.renderer='canvas'] 'canvas' or 'svg'
     * @return {module:zrender/ZRender}
     */
    zrender.init = function(dom, opts) {
        var zr = new ZRender(guid(), dom, opts);
        _instances[zr.id] = zr;
        return zr;
    };

    /**
     * zrender实例销毁
     * @param {module:zrender/ZRender} zr ZRender对象，不传则销毁全部
     */
    zrender.dispose = function (zr) {
        if (zr) {
            zr.dispose();
        }
        else {
            for (var key in _instances) {
                _instances[key].dispose();
            }
            _instances = {};
        }

        return zrender;
    };

    /**
     * 获取zrender实例
     * @param {string} id ZRender对象索引
     * @return {module:zrender/ZRender}
     */
    zrender.getInstance = function (id) {
        return _instances[id];
    };

    /**
     * 删除zrender实例，ZRender实例dispose时会调用，
     * 删除后getInstance则返回undefined
     * ps: 仅是删除，删除的实例不代表已经dispose了~~
     *     这是一个摆脱全局zrender.dispose()自动销毁的后门，
     *     take care of yourself~
     *
     * @param {string} id ZRender对象索引
     */
    zrender.delInstance = function (id) {
        delete _instances[id];
        return zrender;
    };

    function getFrameCallback(zrInstance) {
        return function () {
            if (zrInstance._needsRefreshNextFrame) {
                zrInstance.refresh();
            }
        };
    }

    /**
     * @module zrender/ZRender
     */
    /**
     * @constructor
     * @alias module:zrender/ZRender
     * @param {string} id
     * @param {HTMLDomElement} dom
     * @param {Object} opts
     */
    var ZRender = function(id, dom, opts) {

        opts = opts || {};

        /**
         * 实例 id
         * @type {string}
         */
        this.id = id;
        this.env = env;

        var storage = new Storage();
        var painter = opts.renderer === 'svg'
            ? new SVGPainter(dom, storage)
            : new Painter(dom, storage);

        this.storage = storage;
        this.painter = painter;
        // VML 下为了性能可能会直接操作 VMLRoot 的位置
        // 因此鼠标的相对位置应该是相对于 VMLRoot
        // PENDING
        this.handler = new Handler(useVML ? painter.getVMLRoot() : dom, storage, painter);

        /**
         * @type {module:zrender/animation/Animation}
         */
        this.animation = new Animation({
            stage: {
                update: getFrameCallback(this)
            }
        });
        this.animation.start();

        this._needsRefreshNextFrame = false;

        // 修改 storage.delFromMap, 每次删除元素之前删除动画
        // FIXME 有点ugly
        var self = this;
        var oldDelFromMap = storage.delFromMap;
        var oldAddToMap = storage.addToMap;
        storage.delFromMap = function (elId) {
            var el = storage.get(elId);
            self.stopAnimation(el);
            oldDelFromMap.call(storage, elId);
            el.__zr = null;
        };

        storage.addToMap = function (el) {
            el.__zr = self;
            oldAddToMap.call(storage, el);
        }
    };

    ZRender.prototype = {

        constructor: ZRender,
        /**
         * 获取实例唯一标识
         * @return {string}
         */
        getId: function () {
            return this.id;
        },

        /**
         * 添加元素
         * @param  {string|module:zrender/Element} el
         */
        add: function (el) {
            this.storage.addRoot(el);
            this._needsRefreshNextFrame = true;
        },

        /**
         * 删除元素
         * @param  {string|module:zrender/Element} el
         */
        removes: function (el) {
            this.storage.delRoot(el);
            this._needsRefreshNextFrame = true;
        },

        /**
         * 修改指定zlevel的绘制配置项
         *
         * @param {string} zLevel
         * @param {Object} config 配置对象
         * @param {string} [config.clearColor=0] 每次清空画布的颜色
         * @param {string} [config.motionBlur=false] 是否开启动态模糊
         * @param {number} [config.lastFrameAlpha=0.7]
         *                 在开启动态模糊的时候使用，与上一帧混合的alpha值，值越大尾迹越明显
        */
        configLayer: function (zLevel, config) {
            this.painter.configLayer(zLevel, config);
            this._needsRefreshNextFrame = true;
        },

        /**
         * 渲染
         */
        render: function () {
            return this.refresh();
        },

        /**
         * 视图更新
         */
        refresh: function () {
            this.painter.refresh();
            this._needsRefreshNextFrame = false;
        },

        /**
         * 标记视图在浏览器下一帧需要绘制
         */
        refreshNextFrame: function() {
            this._needsRefreshNextFrame = true;
        },

        /**
         * 调整视图大小
         */
        resize: function() {
            this.painter.resize();
        },

        /**
         * 动画
         *
         * @param {string|module:zrender/Element} el 动画对象
         * @param {string} path 需要添加动画的属性获取路径，可以通过a.b.c来获取深层的属性
         * @param {boolean} [loop] 动画是否循环
         * @return {module:zrender/animation/Animation~Animator}
         * @example:
         *     zr.animate(circle.id, 'style', false)
         *         .when(1000, {x: 10} )
         *         .done(function(){ // Animation done })
         *         .start()
         */
        animate: function (el, path, loop) {
            if (typeof(el) === 'string') {
                el = this.storage.get(el);
            }
            if (el) {
                var target;
                var animatingShape = false;
                if (path) {
                    var pathSplitted = path.split('.');
                    var prop = el;
                    // If animating shape
                    animatingShape = pathSplitted[0] === 'shape';
                    for (var i = 0, l = pathSplitted.length; i < l; i++) {
                        if (!prop) {
                            continue;
                        }
                        prop = prop[pathSplitted[i]];
                    }
                    if (prop) {
                        target = prop;
                    }
                }
                else {
                    target = el;
                }

                if (!target) {
                    log(
                        'Property "'
                        + path
                        + '" is not existed in element '
                        + el.id
                    );
                    return;
                }

                if (el.__animators == null) {
                    // 正在进行的动画记数
                    el.__animators = [];
                }
                var animators = el.__animators;

                var animator = this.animation.animate(target, { loop: loop })
                    .during(function () {
                        el.dirty(animatingShape);
                    })
                    .done(function () {
                        animators.splice(util.indexOf(animators, animator), 1);
                    });
                animators.push(animator);

                return animator;
            }
            else {
                log('Element not existed');
            }
        },

        /**
         * 停止动画对象的动画
         * @param  {string|module:zrender/Element} el
         */
        stopAnimation: function (el) {
            if (el.__animators) {
                var animators = el.__animators;
                var len = animators.length;
                for (var i = 0; i < len; i++) {
                    animators[i].stop();
                }
                animators.length = 0;
            }
        },

        /**
         * 停止所有动画
         */
        clearAnimation: function () {
            this.animation.clear();
        },

        /**
         * 获取视图宽度
         */
        getWidth: function() {
            return this.painter.getWidth();
        },

        /**
         * 获取视图高度
         */
        getHeight: function() {
            return this.painter.getHeight();
        },

        /**
         * 图像导出
         * @param {string} type
         * @param {string} [backgroundColor='#fff'] 背景色
         * @return {string} 图片的Base64 url
         */
        toDataURL: function(type, backgroundColor, args) {
            return this.painter.toDataURL(type, backgroundColor, args);
        },

        /**
         * 将常规shape转成image shape
         * @param {module:zrender/shape/Base} e
         * @param {number} width
         * @param {number} height
         */
        pathToImage: function(e, width, height) {
            var id = guid();
            return this.painter.pathToImage(id, e, width, height);
        },

        /**
         * 事件绑定
         *
         * @param {string} eventName 事件名称
         * @param {Function} eventHandler 响应函数
         * @param {Object} [context] 响应函数
         */
        on: function(eventName, eventHandler, context) {
            this.handler.on(eventName, eventHandler, context);
        },

        /**
         * 事件解绑定，参数为空则解绑所有自定义事件
         *
         * @param {string} eventName 事件名称
         * @param {Function} eventHandler 响应函数
         */
        off: function(eventName, eventHandler) {
            this.handler.off(eventName, eventHandler);
        },

        /**
         * 事件触发
         *
         * @param {string} eventName 事件名称，resize，hover，drag，etc
         * @param {event=} event event dom事件对象
         */
        trigger: function (eventName, event) {
            this.handler.trigger(eventName, event);
        },


        /**
         * 清除当前ZRender下所有类图的数据和显示，clear后MVC和已绑定事件均还存在在，ZRender可用
         */
        clear: function () {
            this.storage.delRoot();
            this.painter.clear();
        },

        /**
         * 释放当前ZR实例（删除包括dom，数据、显示和事件绑定），dispose后ZR不可用
         */
        dispose: function () {
            this.animation.stop();

            this.clear();
            this.storage.dispose();
            this.painter.dispose();
            this.handler.dispose();

            this.animation =
            this.storage =
            this.painter =
            this.handler = null;

            // 释放后告诉全局删除对自己的索引，没想到啥好方法
            zrender.delInstance(this.id);
        }
    };

    return zrender;
});
