/**
 * @ngdoc service
 * @name $ionicHistory
 * @module ionic
 * @description
 * ImoNote: $ionicHistory 记录了用户一路导航过来的视图们，就像浏览器的表现那样！（区别是典型的浏览器有且仅有一个历史栈）
 * $ionicHistory keeps track of views as the user navigates through an app. Similar to the way a
 * browser behaves, an Ionic app is able to keep track of the previous view, the current view, and
 * the forward view (if there is one).  However, a typical web browser only keeps track of one
 * history stack in a linear fashion.
 * ImoNote: 不像传统的浏览器环境，apps 和 webapps 有平行无依赖关系的历史们（e.g. tabs：各个 tab 有各自的历史栈，互相无依赖关系）
 * Unlike a traditional browser environment, apps and webapps have parallel independent histories,
 * such as with tabs. Should a user navigate few pages deep on one tab, and then switch to a new
 * tab and back, the back button relates not to the previous tab, but to the previous pages
 * visited within _that_ tab.
 * ImoNote: `$ionicHistory` 使能了这种平行的历史架构
 * `$ionicHistory` facilitates this parallel history architecture.
 */

IonicModule
.factory('$ionicHistory', [
  '$rootScope',
  '$state',
  '$location',
  '$window',
  '$timeout',
  // ImoNote:TODO: 下面两个不太了解 
  '$ionicViewSwitcher',
  '$ionicNavViewDelegate',
function($rootScope, $state, $location, $window, $timeout, $ionicViewSwitcher, $ionicNavViewDelegate) {

  // history actions while navigating views
  var ACTION_INITIAL_VIEW = 'initialView';
  var ACTION_NEW_VIEW = 'newView';
  var ACTION_MOVE_BACK = 'moveBack';
  var ACTION_MOVE_FORWARD = 'moveForward';

  // direction of navigation
  var DIRECTION_BACK = 'back';
  var DIRECTION_FORWARD = 'forward';
  var DIRECTION_ENTER = 'enter';
  var DIRECTION_EXIT = 'exit';
  var DIRECTION_SWAP = 'swap';
  var DIRECTION_NONE = 'none';

  var stateChangeCounter = 0;
  var lastStateId, nextViewOptions, deregisterStateChangeListener, nextViewExpireTimer, forcedNav;

	/**
	 * ImoNote:
	 * - histories 和 views 都是字典，一个记录历史，一个记录视图
	 * - stack 记录的也是 view 吧？因为看到一个 stack[0].go 的用法（go 方法是 View 实例的方法）
	 * - （stack 可能：有 stateName/stateParams,有 url，有 scope；这些可能统统来自 initialize 时传入的 data 参数？！） 
	 * TODO: 
	 * histories 怎么用呢？
	 * views 怎么来的呢？三个 view（back forword current）可以隶属不同的 history？
	 */
  var viewHistory = {
    histories: { root: { historyId: 'root', parentHistoryId: null, stack: [], cursor: -1 } },
    views: {},
    backView: null,
    forwardView: null,
    currentView: null
  };

	// ImoNote: View 类
	var View = function() {};
	/**
	 * ImoNote: 这里的 data 形如：
	 * {
	 *   backViewId
	 *   canSwipeBack: true
	 *   forwordViewId
	 *   historyId: "ion2"
	 *   index: number
	 *   stateId: "tab.dash"
	 *   stateName: "tab.dash"
	 *   stateParams
	 *   url: "/tab/dash"
	 *   viewId: "ion5"
	 * }
	 * scope ???
	 */
  View.prototype.initialize = function(data) {
    if (data) {
      for (var name in data) this[name] = data[name];
      return this;
    }
    return null;
  };
  View.prototype.go = function() {

    if (this.stateName) {
      return $state.go(this.stateName, this.stateParams);
    }

    if (this.url && this.url !== $location.url()) {

      if (viewHistory.backView === this) {
        return $window.history.go(-1);
      } else if (viewHistory.forwardView === this) {
        return $window.history.go(1);
      }

      $location.url(this.url);
    }

    return null;
  };
  View.prototype.destroy = function() {
    if (this.scope) {
      this.scope.$destroy && this.scope.$destroy();
      this.scope = null;
    }
  };

	// ImoNote: 根据 getBackView 和 getForwardView，view 还可能有 backViewId,forwardViewId 两个属性
  function getViewById(viewId) {
    return (viewId ? viewHistory.views[ viewId ] : null);
  }

  function getBackView(view) {
    return (view ? getViewById(view.backViewId) : null);
  }

  function getForwardView(view) {
    return (view ? getViewById(view.forwardViewId) : null);
  }

  function getHistoryById(historyId) {
    return (historyId ? viewHistory.histories[ historyId ] : null);
  }

	/**
	 * ImoNote: viewHistory 初始化时有 'root' 历史的 parentHistoryId 是 null 很好理解，
	 * TODO: 但是下面函数新添加的 history 的 parentHistoryId 来自父 scope 的 $historyId 怎么理解呢？？？
	 */
  function getHistory(scope) {
    var histObj = getParentHistoryObj(scope);

    if (!viewHistory.histories[ histObj.historyId ]) {
      // this history object exists in parent scope, but doesn't
      // exist in the history data yet
      viewHistory.histories[ histObj.historyId ] = {
        historyId: histObj.historyId,
        parentHistoryId: getParentHistoryObj(histObj.scope.$parent).historyId,
        stack: [],
        cursor: -1
      };
    }
    return getHistoryById(histObj.historyId);
  }

	// ImoNote: historyObj 记录 historyId 和 scope；可能需要遍历 scope chain 来找到，默认值为 'root' 和 $rootScope
  function getParentHistoryObj(scope) {
    var parentScope = scope;
    while (parentScope) {
      if (parentScope.hasOwnProperty('$historyId')) {
        // this parent scope has a historyId
        return { historyId: parentScope.$historyId, scope: parentScope };
      }
      // nothing found keep climbing up
      parentScope = parentScope.$parent;
    }
    // no history for the parent, use the root
    return { historyId: 'root', scope: $rootScope };
  }

	// ImoNote: 根据 viewId 查找 view，并将 view 作为 viewHistory.currentView，相关的 backView 和 forwardView 更新到 viewHistory
  function setNavViews(viewId) {
    viewHistory.currentView = getViewById(viewId);
    viewHistory.backView = getBackView(viewHistory.currentView);
    viewHistory.forwardView = getForwardView(viewHistory.currentView);
  }

	// ImoNote: 获取唯一 stateId 的方法（要么根据 $state.current.name 和 $state.params 生成唯一 id；下策是使用工具方法生成）
  function getCurrentStateId() {
    var id;
    if ($state && $state.current && $state.current.name) {
      id = $state.current.name;
      if ($state.params) {
        for (var key in $state.params) {
          if ($state.params.hasOwnProperty(key) && $state.params[key]) {
            id += "_" + key + "=" + $state.params[key];
          }
        }
      }
      return id;
    }
    // if something goes wrong make sure its got a unique stateId
    return ionic.Utils.nextUid();
  }

	// ImoNote: 仅一层地深拷贝 $state.params 对象
  function getCurrentStateParams() {
    var rtn;
    if ($state && $state.params) {
      for (var key in $state.params) {
        if ($state.params.hasOwnProperty(key)) {
          rtn = rtn || {};
          rtn[key] = $state.params[key];
        }
      }
    }
    return rtn;
  }


  return {

		// TODO:
		/**
		 * ImoNote: 
		 * 仅在 /js/angular/controller/navViewController.js,有 `var registerData = $ionicHistory.register($scope, viewLocals);`
		 * - parentScope 会是 $ionicNavView 控制器对应的 $scope
		 * - viewLocals 
		 *   => navViewController.js, (navViewController)self.register 
		 *   => navView.js, navViewCtrl.register(viewLocals) 
		 *   => navView.js, var viewLocals = $state.$current && $state.$current.locals[viewData.name]; // TODO:
		 *   (P.S. 每当 ionNavView 这个指令的 compile 方法被调用的时候，总会 register)
		 */
    register: function(parentScope, viewLocals) {

      var currentStateId = getCurrentStateId(),
          hist = getHistory(parentScope),
          currentView = viewHistory.currentView,
          backView = viewHistory.backView,
          forwardView = viewHistory.forwardView,
          viewId = null,
          action = null,
          direction = DIRECTION_NONE,
          historyId = hist.historyId,
          url = $location.url(),
          tmp, x, ele;

      // ImoNote: stateChangeCounter 是用来记录 lastStateId 的变化次数的
      if (lastStateId !== currentStateId) {
        lastStateId = currentStateId;
        stateChangeCounter++;
      }

			// ImoNote: 当调用了 goToHistoryRoot 方法的时候，forcedNav 才有值
      if (forcedNav) {
        // we've previously set exactly what to do
        viewId = forcedNav.viewId;
        action = forcedNav.action;
        direction = forcedNav.direction;
        forcedNav = null;

      } else if (backView && backView.stateId === currentStateId) {
        // they went back one, set the old current view as a forward view
        viewId = backView.viewId;
        historyId = backView.historyId;
        action = ACTION_MOVE_BACK;
        if (backView.historyId === currentView.historyId) {
          // went back in the same history
          direction = DIRECTION_BACK;

        } else if (currentView) {
          direction = DIRECTION_EXIT;

          tmp = getHistoryById(backView.historyId);
          if (tmp && tmp.parentHistoryId === currentView.historyId) {
            direction = DIRECTION_ENTER;

          } else {
            tmp = getHistoryById(currentView.historyId);
            if (tmp && tmp.parentHistoryId === hist.parentHistoryId) {
              direction = DIRECTION_SWAP;
            }
          }
        }

      } else if (forwardView && forwardView.stateId === currentStateId) {
        // they went to the forward one, set the forward view to no longer a forward view
        viewId = forwardView.viewId;
        historyId = forwardView.historyId;
        action = ACTION_MOVE_FORWARD;
        if (forwardView.historyId === currentView.historyId) {
          direction = DIRECTION_FORWARD;

        } else if (currentView) {
          direction = DIRECTION_EXIT;

          if (currentView.historyId === hist.parentHistoryId) {
            direction = DIRECTION_ENTER;

          } else {
            tmp = getHistoryById(currentView.historyId);
            if (tmp && tmp.parentHistoryId === hist.parentHistoryId) {
              direction = DIRECTION_SWAP;
            }
          }
        }

        tmp = getParentHistoryObj(parentScope);
        if (forwardView.historyId && tmp.scope) {
          // if a history has already been created by the forward view then make sure it stays the same
          tmp.scope.$historyId = forwardView.historyId;
          historyId = forwardView.historyId;
        }

      } else if (currentView && currentView.historyId !== historyId &&
                hist.cursor > -1 && hist.stack.length > 0 && hist.cursor < hist.stack.length &&
                hist.stack[hist.cursor].stateId === currentStateId) {
				// ImoNote: 切换到一个已经有 views 的不同历史的 case
        // they just changed to a different history and the history already has views in it
        var switchToView = hist.stack[hist.cursor];
        viewId = switchToView.viewId;
        historyId = switchToView.historyId;
        action = ACTION_MOVE_BACK;
        direction = DIRECTION_SWAP;

        tmp = getHistoryById(currentView.historyId);
        if (tmp && tmp.parentHistoryId === historyId) {
          direction = DIRECTION_EXIT;

        } else {
          tmp = getHistoryById(historyId);
          if (tmp && tmp.parentHistoryId === currentView.historyId) {
            direction = DIRECTION_ENTER;
          }
        }

				// ImoNote: 当切换到一个不同的历史，且我们切换到的那个历史存在一个不属于这个历史的 back view 时，最好使用 current view 作为 back view
        // if switching to a different history, and the history of the view we're switching
        // to has an existing back view from a different history than itself, then
        // it's back view would be better represented using the current view as its back view
        tmp = getViewById(switchToView.backViewId);
        if (tmp && switchToView.historyId !== tmp.historyId) {
          // the new view is being removed from it's old position in the history and being placed at the top,
          // so we need to update any views that reference it as a backview, otherwise there will be infinitely loops
          var viewIds = Object.keys(viewHistory.views);
          viewIds.forEach(function(viewId) {
            var view = viewHistory.views[viewId];
            if ((view.backViewId === switchToView.viewId) && (view.historyId !== switchToView.historyId)) {
              view.backViewId = null;
            }
          });

          hist.stack[hist.cursor].backViewId = currentView.viewId;
        }

      } else {
				// ImoNote: 唯一使用 $ionicViewSwitcher 的地方
        // create an element from the viewLocals template
        ele = $ionicViewSwitcher.createViewEle(viewLocals);
        if (this.isAbstractEle(ele, viewLocals)) {
					// ImoNote:TODO: 这个返回结果不是很懂。。
          return {
            action: 'abstractView',
            direction: DIRECTION_NONE,
            ele: ele
          };
        }

				// ImoNote:TODO: 为什么这里直接弃疗使用 ionic.Utils.nextUid 来获取独一 id 了？
        // set a new unique viewId
        viewId = ionic.Utils.nextUid();

        if (currentView) {
          // set the forward view if there is a current view (ie: if its not the first view)
          currentView.forwardViewId = viewId;

          action = ACTION_NEW_VIEW;

          // check if there is a new forward view within the same history
          if (forwardView && currentView.stateId !== forwardView.stateId &&
             currentView.historyId === forwardView.historyId) {
            // they navigated to a new view but the stack already has a forward view
            // since its a new view remove any forwards that existed
            tmp = getHistoryById(forwardView.historyId);
            if (tmp) {
              // the forward has a history
              for (x = tmp.stack.length - 1; x >= forwardView.index; x--) {
                // starting from the end destroy all forwards in this history from this point
                var stackItem = tmp.stack[x];
                stackItem && stackItem.destroy && stackItem.destroy();
                tmp.stack.splice(x);
              }
              historyId = forwardView.historyId;
            }
          }

          // its only moving forward if its in the same history
          if (hist.historyId === currentView.historyId) {
            direction = DIRECTION_FORWARD;

          } else if (currentView.historyId !== hist.historyId) {
            // DB: this is a new view in a different tab
            direction = DIRECTION_ENTER;

            tmp = getHistoryById(currentView.historyId);
            if (tmp && tmp.parentHistoryId === hist.parentHistoryId) {
              direction = DIRECTION_SWAP;

            } else {
              tmp = getHistoryById(tmp.parentHistoryId);
              if (tmp && tmp.historyId === hist.historyId) {
                direction = DIRECTION_EXIT;
              }
            }
          }

        } else {
          // there's no current view, so this must be the initial view
          action = ACTION_INITIAL_VIEW;
        }

        if (stateChangeCounter < 2) {
          // views that were spun up on the first load should not animate
          direction = DIRECTION_NONE;
        }

        // add the new view
        viewHistory.views[viewId] = this.createView({
          viewId: viewId,
          index: hist.stack.length,
          historyId: hist.historyId,
          backViewId: (currentView && currentView.viewId ? currentView.viewId : null),
          forwardViewId: null,
          stateId: currentStateId,
          stateName: this.currentStateName(),
          stateParams: getCurrentStateParams(),
          url: url,
          canSwipeBack: canSwipeBack(ele, viewLocals)
        });

        // add the new view to this history's stack
        hist.stack.push(viewHistory.views[viewId]);
      }

      deregisterStateChangeListener && deregisterStateChangeListener();
      $timeout.cancel(nextViewExpireTimer);
      if (nextViewOptions) {
        if (nextViewOptions.disableAnimate) direction = DIRECTION_NONE;
        if (nextViewOptions.disableBack) viewHistory.views[viewId].backViewId = null;
        if (nextViewOptions.historyRoot) {
          for (x = 0; x < hist.stack.length; x++) {
						/**
						 * ImoNote: 在 stack 找到对应的 view（引用类型），修改其 index 为 0，backViewId 和 forwardViewId 为 null
						 * 在 views 中删除其他 view 的记录
						 */
            if (hist.stack[x].viewId === viewId) {
              hist.stack[x].index = 0;
              hist.stack[x].backViewId = hist.stack[x].forwardViewId = null;
            } else {
              delete viewHistory.views[hist.stack[x].viewId];
            }
					}
					// ImoNote: stack 变成 [找到的 view]
          hist.stack = [viewHistory.views[viewId]];
        }
        nextViewOptions = null;
      }

      setNavViews(viewId);

      if (viewHistory.backView && historyId == viewHistory.backView.historyId && currentStateId == viewHistory.backView.stateId && url == viewHistory.backView.url) {
        for (x = 0; x < hist.stack.length; x++) {
          if (hist.stack[x].viewId == viewId) {
            action = 'dupNav';
            direction = DIRECTION_NONE;
            if (x > 0) {
              hist.stack[x - 1].forwardViewId = null;
            }
            viewHistory.forwardView = null;
            viewHistory.currentView.index = viewHistory.backView.index;
            viewHistory.currentView.backViewId = viewHistory.backView.backViewId;
            viewHistory.backView = getBackView(viewHistory.backView);
            hist.stack.splice(x, 1);
            break;
          }
        }
      }

      hist.cursor = viewHistory.currentView.index;

      return {
        viewId: viewId,
        action: action,
        direction: direction,
        historyId: historyId,
        enableBack: this.enabledBack(viewHistory.currentView),
        isHistoryRoot: (viewHistory.currentView.index === 0),
        ele: ele
      };
    },

    registerHistory: function(scope) {
      scope.$historyId = ionic.Utils.nextUid();
    },

    createView: function(data) {
      var newView = new View();
      return newView.initialize(data);
    },

    getViewById: getViewById,

    /**
     * @ngdoc method
     * @name $ionicHistory#viewHistory
     * @description The app's view history data, such as all the views and histories, along
     * with how they are ordered and linked together within the navigation stack.
     * @returns {object} Returns an object containing the apps view history data.
     */
    viewHistory: function() {
      return viewHistory;
    },

    /**
     * @ngdoc method
     * @name $ionicHistory#currentView
     * @description The app's current view.
     * @returns {object} Returns the current view.
     */
		// ImoNote: 和 backView 方法类似，有参更新并返回，无参直接获取返回
    currentView: function(view) {
      if (arguments.length) {
        viewHistory.currentView = view;
      }
      return viewHistory.currentView;
    },

    /**
     * @ngdoc method
     * @name $ionicHistory#currentHistoryId
     * @description The ID of the history stack which is the parent container of the current view.
     * @returns {string} Returns the current history ID.
     */
    currentHistoryId: function() {
      return viewHistory.currentView ? viewHistory.currentView.historyId : null;
    },

    /**
     * @ngdoc method
     * @name $ionicHistory#currentTitle
     * @description Gets and sets the current view's title.
     * @param {string=} val The title to update the current view with.
     * @returns {string} Returns the current view's title.
     */
    currentTitle: function(val) {
      if (viewHistory.currentView) {
        if (arguments.length) {
          viewHistory.currentView.title = val;
        }
        return viewHistory.currentView.title;
      }
    },

    /**
     * @ngdoc method
     * @name $ionicHistory#backView
     * @description Returns the view that was before the current view in the history stack.
     * If the user navigated from View A to View B, then View A would be the back view, and
     * View B would be the current view.
     * @returns {object} Returns the back view.
     */
		// ImoNote: 传参表示参数 view 更新到 viewHistory.backView，并返回 viewHistory.backView(view)；无参返回 viewHistory.backView
    backView: function(view) {
      if (arguments.length) {
        viewHistory.backView = view;
      }
      return viewHistory.backView;
    },

    /**
     * @ngdoc method
     * @name $ionicHistory#backTitle
     * @description Gets the back view's title.
     * @returns {string} Returns the back view's title.
     */
    backTitle: function(view) {
      var backView = (view && getViewById(view.backViewId)) || viewHistory.backView;
      return backView && backView.title;
    },

    /**
     * @ngdoc method
     * @name $ionicHistory#forwardView
     * @description Returns the view that was in front of the current view in the history stack.
     * A forward view would exist if the user navigated from View A to View B, then
     * navigated back to View A. At this point then View B would be the forward view, and View
     * A would be the current view.
     * @returns {object} Returns the forward view.
     */
		// ImoNote: 和 backView 方法类似，有参更新并返回，无参直接获取返回
    forwardView: function(view) {
      if (arguments.length) {
        viewHistory.forwardView = view;
      }
      return viewHistory.forwardView;
    },

    /**
     * @ngdoc method
     * @name $ionicHistory#currentStateName
     * @description Returns the current state name.
     * @returns {string}
     */
    currentStateName: function() {
      return ($state && $state.current ? $state.current.name : null);
    },

    isCurrentStateNavView: function(navView) {
      return !!($state && $state.current && $state.current.views && $state.current.views[navView]);
    },

    goToHistoryRoot: function(historyId) {
      if (historyId) {
				var hist = getHistoryById(historyId);
				// ImoNote: 如果指定 history 的栈非空，即 root 存在，那么继续
        if (hist && hist.stack.length) {
					// ImoNote: 如果当前 currentView.viewId 已经是指定 history 的 stack 的栈底了，那么已经达到目标，直接返回即可
          if (viewHistory.currentView && viewHistory.currentView.viewId === hist.stack[0].viewId) {
            return;
					}
					// ImoNote: 否则，设置 forceNav
          forcedNav = {
            viewId: hist.stack[0].viewId,
            action: ACTION_MOVE_BACK,
            direction: DIRECTION_BACK
          };
          hist.stack[0].go();
        }
      }
    },

    /**
     * @ngdoc method
     * @name $ionicHistory#goBack
     * @param {number=} backCount Optional negative integer setting how many views to go
     * back. By default it'll go back one view by using the value `-1`. To go back two
     * views you would use `-2`. If the number goes farther back than the number of views
     * in the current history's stack then it'll go to the first view in the current history's
     * stack. If the number is zero or greater then it'll do nothing. It also does not
     * cross history stacks, meaning it can only go as far back as the current history.
     * @description Navigates the app to the back view, if a back view exists.
     */
    goBack: function(backCount) {
      if (isDefined(backCount) && backCount !== -1) {
        if (backCount > -1) return;

        var currentHistory = viewHistory.histories[this.currentHistoryId()];
        var newCursor = currentHistory.cursor + backCount + 1;
        if (newCursor < 1) {
          newCursor = 1;
        }

        currentHistory.cursor = newCursor;
        setNavViews(currentHistory.stack[newCursor].viewId);

        var cursor = newCursor - 1;
        var clearStateIds = [];
        var fwdView = getViewById(currentHistory.stack[cursor].forwardViewId);
        while (fwdView) {
          clearStateIds.push(fwdView.stateId || fwdView.viewId);
          cursor++;
          if (cursor >= currentHistory.stack.length) break;
          fwdView = getViewById(currentHistory.stack[cursor].forwardViewId);
        }

        var self = this;
        if (clearStateIds.length) {
          $timeout(function() {
            self.clearCache(clearStateIds);
          }, 300);
        }
      }

      viewHistory.backView && viewHistory.backView.go();
    },

    /**
     * @ngdoc method
     * @name $ionicHistory#removeBackView
     * @description Remove the previous view from the history completely, including the
     * cached element and scope (if they exist).
     */
    removeBackView: function() {
      var self = this;
      var currentHistory = viewHistory.histories[this.currentHistoryId()];
      var currentCursor = currentHistory.cursor;

      var currentView = currentHistory.stack[currentCursor];
      var backView = currentHistory.stack[currentCursor - 1];
      var replacementView = currentHistory.stack[currentCursor - 2];

      // fail if we dont have enough views in the history
      if (!backView || !replacementView) {
        return;
      }

      // remove the old backView and the cached element/scope
      currentHistory.stack.splice(currentCursor - 1, 1);
      self.clearCache([backView.viewId]);
      // make the replacementView and currentView point to each other (bypass the old backView)
      currentView.backViewId = replacementView.viewId;
      currentView.index = currentView.index - 1;
      replacementView.forwardViewId = currentView.viewId;
      // update the cursor and set new backView
      viewHistory.backView = replacementView;
      currentHistory.currentCursor += -1;
    },

    enabledBack: function(view) {
      var backView = getBackView(view);
      return !!(backView && backView.historyId === view.historyId);
    },

    /**
     * @ngdoc method
     * @name $ionicHistory#clearHistory
     * @description Clears out the app's entire history, except for the current view.
     */
    clearHistory: function() {
      var
      histories = viewHistory.histories,
      currentView = viewHistory.currentView;

      if (histories) {
        for (var historyId in histories) {

          if (histories[historyId].stack) {
            histories[historyId].stack = [];
            histories[historyId].cursor = -1;
          }

          if (currentView && currentView.historyId === historyId) {
            currentView.backViewId = currentView.forwardViewId = null;
            histories[historyId].stack.push(currentView);
          } else if (histories[historyId].destroy) {
            histories[historyId].destroy();
          }

        }
      }

      for (var viewId in viewHistory.views) {
        if (viewId !== currentView.viewId) {
          delete viewHistory.views[viewId];
        }
      }

      if (currentView) {
        setNavViews(currentView.viewId);
      }
    },

    /**
     * @ngdoc method
     * @name $ionicHistory#clearCache
	   * @return promise
     * @description Removes all cached views within every {@link ionic.directive:ionNavView}.
     * This both removes the view element from the DOM, and destroy it's scope.
     */
		/**
		 * ImoNote: 
		 * 唯一使用 $ionicViewSwitcher 的地方！
		 *   => navViewDelegate.js, ionic.DelegateService(['clearCache'])
		 *   => delegateService.js, 
		 * 这个方法不得了？！看官方注释 view element 是一直在 DOM 中么？
		 */  
    clearCache: function(stateIds) {
      return $timeout(function() {
        $ionicNavViewDelegate._instances.forEach(function(instance) {
          instance.clearCache(stateIds);
        });
      });
    },

    /**
     * @ngdoc method
     * @name $ionicHistory#nextViewOptions
     * @description Sets options for the next view. This method can be useful to override
     * certain view/transition defaults right before a view transition happens. For example,
     * the {@link ionic.directive:menuClose} directive uses this method internally to ensure
     * an animated view transition does not happen when a side menu is open, and also sets
     * the next view as the root of its history stack. After the transition these options
     * are set back to null.
     *
     * Available options:
     *
     * * `disableAnimate`: Do not animate the next transition.
     * * `disableBack`: The next view should forget its back view, and set it to null.
     * * `historyRoot`: The next view should become the root view in its history stack.
     *
     * ```js
     * $ionicHistory.nextViewOptions({
     *   disableAnimate: true,
     *   disableBack: true
     * });
     * ```
     */
    nextViewOptions: function(opts) {
      deregisterStateChangeListener && deregisterStateChangeListener();
      if (arguments.length) {
        $timeout.cancel(nextViewExpireTimer);
        if (opts === null) {
          nextViewOptions = opts;
        } else {
          nextViewOptions = nextViewOptions || {};
          extend(nextViewOptions, opts);
          if (nextViewOptions.expire) {
              deregisterStateChangeListener = $rootScope.$on('$stateChangeSuccess', function() {
                nextViewExpireTimer = $timeout(function() {
                  nextViewOptions = null;
                  }, nextViewOptions.expire);
              });
          }
        }
      }
      return nextViewOptions;
    },

		// ImoNote: 优先通过 viewLocals 判断是否 abstract；如果非，再通过 ele 及其直系子元素判断
    isAbstractEle: function(ele, viewLocals) {
      if (viewLocals && viewLocals.$$state && viewLocals.$$state.self['abstract']) {
        return true;
      }
      return !!(ele && (isAbstractTag(ele) || isAbstractTag(ele.children())));
    },

    isActiveScope: function(scope) {
      if (!scope) return false;

      var climbScope = scope;
      var currentHistoryId = this.currentHistoryId();
      var foundHistoryId;

      while (climbScope) {
        if (climbScope.$$disconnected) {
          return false;
        }

        if (!foundHistoryId && climbScope.hasOwnProperty('$historyId')) {
          foundHistoryId = true;
        }

        if (currentHistoryId) {
          if (climbScope.hasOwnProperty('$historyId') && currentHistoryId == climbScope.$historyId) {
            return true;
          }
          if (climbScope.hasOwnProperty('$activeHistoryId')) {
            if (currentHistoryId == climbScope.$activeHistoryId) {
              if (climbScope.hasOwnProperty('$historyId')) {
                return true;
              }
              if (!foundHistoryId) {
                return true;
              }
            }
          }
        }

        if (foundHistoryId && climbScope.hasOwnProperty('$activeHistoryId')) {
          foundHistoryId = false;
        }

        climbScope = climbScope.$parent;
      }

      return currentHistoryId ? currentHistoryId == 'root' : true;
    }

  };

	// ImoNote: ion-side-menu 和 ion-tabs 视为 abstract tags；P.S. ele 这里应该是一个 jq 元素，所以先 [0] 取到原生 element
  function isAbstractTag(ele) {
    return ele && ele.length && /ion-side-menus|ion-tabs/i.test(ele[0].tagName);
  }

  function canSwipeBack(ele, viewLocals) {
    if (viewLocals && viewLocals.$$state && viewLocals.$$state.self.canSwipeBack === false) {
      return false;
    }
    if (ele && ele.attr('can-swipe-back') === 'false') {
      return false;
    }
    var eleChild = ele.find('ion-view');
    if (eleChild && eleChild.attr('can-swipe-back') === 'false') {
      return false;
    }
    return true;
  }

}])

.run([
  '$rootScope',
  '$state',
  '$location',
  '$document',
  '$ionicPlatform',
  '$ionicHistory',
  'IONIC_BACK_PRIORITY',
function($rootScope, $state, $location, $document, $ionicPlatform, $ionicHistory, IONIC_BACK_PRIORITY) {

  // always reset the keyboard state when change stage
  $rootScope.$on('$ionicView.beforeEnter', function() {
    ionic.keyboard && ionic.keyboard.hide && ionic.keyboard.hide();
  });

  $rootScope.$on('$ionicHistory.change', function(e, data) {
    if (!data) return null;

    var viewHistory = $ionicHistory.viewHistory();

    var hist = (data.historyId ? viewHistory.histories[ data.historyId ] : null);
    if (hist && hist.cursor > -1 && hist.cursor < hist.stack.length) {
      // the history they're going to already exists
      // go to it's last view in its stack
      var view = hist.stack[ hist.cursor ];
      return view.go(data);
    }

    // this history does not have a URL, but it does have a uiSref
    // figure out its URL from the uiSref
    if (!data.url && data.uiSref) {
      data.url = $state.href(data.uiSref);
    }

    if (data.url) {
      // don't let it start with a #, messes with $location.url()
      if (data.url.indexOf('#') === 0) {
        data.url = data.url.replace('#', '');
      }
      if (data.url !== $location.url()) {
        // we've got a good URL, ready GO!
        $location.url(data.url);
      }
    }
  });

  $rootScope.$ionicGoBack = function(backCount) {
    $ionicHistory.goBack(backCount);
  };

  // Set the document title when a new view is shown
  $rootScope.$on('$ionicView.afterEnter', function(ev, data) {
    if (data && data.title) {
      $document[0].title = data.title;
    }
  });

  // Triggered when devices with a hardware back button (Android) is clicked by the user
  // This is a Cordova/Phonegap platform specifc method
  function onHardwareBackButton(e) {
    var backView = $ionicHistory.backView();
    if (backView) {
      // there is a back view, go to it
      backView.go();
    } else {
      // there is no back view, so close the app instead
      ionic.Platform.exitApp();
    }
    e.preventDefault();
    return false;
  }
  $ionicPlatform.registerBackButtonAction(
    onHardwareBackButton,
    IONIC_BACK_PRIORITY.view
  );

}]);
