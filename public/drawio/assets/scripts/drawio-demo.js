var darkThemeLink = document.getElementById('drawio-dark-theme');
var currentTheme = 'light';
var currentLanguage = typeof mxLanguage === 'string' ? mxLanguage : 'en';
var fatalNotified = false;
var fileMenuPatched = false;
var actionsPatched = false;
var exportIntegrationPatched = false;
var TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAukB9pZY4j8AAAAASUVORK5CYII=";

function notifyFatal(reason) {
  if (fatalNotified) return;
  fatalNotified = true;
  try {
    window.parent.postMessage(
      {
        eventName: 'fatal-error',
        value: {
          reason: reason || 'draw.io fatal error',
        },
      },
      '*',
    );
  } catch (err) {
    console.error('notifyFatal failed', err);
  }
}

window.addEventListener('error', function(event) {
  if (!event) return;
  var message = event.message || (event.error && event.error.message) || 'draw.io error';
  notifyFatal(message);
});

window.addEventListener('unhandledrejection', function(event) {
  if (!event) return;
  var reason = event.reason;
  var message = typeof reason === 'string' ? reason : (reason && reason.message) || 'draw.io unhandled rejection';
  notifyFatal(message);
});

function postHostEvent(eventName, value) {
  try {
    window.parent.postMessage(
      {
        eventName: eventName,
        value: value || null,
      },
      '*',
    );
  } catch (err) {
    console.warn('postHostEvent failed', err);
  }
}

function requestNewFileFromHost() {
  stopEditingIfNeeded();
  postHostEvent('request-new-file');
}

function requestSaveFromHost() {
  stopEditingIfNeeded();
  postHostEvent('request-save');
}

function requestSaveAsFromHost() {
  stopEditingIfNeeded();
  postHostEvent('request-save-as');
}

function stopEditingIfNeeded() {
  try {
    if (window.editorUIInstance && window.editorUIInstance.editor && window.editorUIInstance.editor.graph) {
      window.editorUIInstance.editor.graph.stopEditing(false);
    }
  } catch (err) {
    console.warn('stopEditingIfNeeded failed', err);
  }
}

function postExportPayloadToHost(payload) {
  try {
    postHostEvent('export-diagram', payload);
  } catch (err) {
    console.warn('postExportPayloadToHost failed', err);
  }
}

function ensureExportIntegration() {
  if (exportIntegrationPatched) {
    return;
  }
  if (typeof ExportDialog === 'undefined' || typeof EditorUi === 'undefined' || typeof mxUtils === 'undefined') {
    setTimeout(ensureExportIntegration, 50);
    return;
  }
  exportIntegrationPatched = true;

  var originalExportFile = ExportDialog.exportFile;
  ExportDialog.exportFile = function(editorUi, name, format, bg, scale, border, dpi, grid) {
    if (handleExportRequest(editorUi, name, format, bg, scale, border)) {
      return;
    }
    return originalExportFile.apply(this, arguments);
  };

  var originalSaveLocalFile = ExportDialog.saveLocalFile;
  if (typeof originalSaveLocalFile === 'function') {
    ExportDialog.saveLocalFile = function(editorUi, data, filename, format) {
      if (handleTextExport(editorUi, data, filename, format)) {
        return;
      }
      return originalSaveLocalFile.apply(this, arguments);
    };
  }
}

function handleExportRequest(editorUi, rawName, rawFormat, bg, rawScale, rawBorder) {
  if (!editorUi || !editorUi.editor) {
    return false;
  }
  var format = typeof rawFormat === 'string' ? rawFormat.toLowerCase() : 'png';
  if (format === 'xml') {
    return exportXml(editorUi, rawName);
  }
  if (format === 'svg') {
    return exportSvg(editorUi, rawName, bg, rawScale, rawBorder);
  }
  if (format === 'png' || format === 'jpeg' || format === 'jpg') {
    return exportImage(editorUi, rawName, format, bg, rawScale, rawBorder);
  }
  mxUtils.alert(resolveUnsupportedFormatMessage());
  editorUi.hideDialog();
  return true;
}

function handleTextExport(editorUi, data, filename, format) {
  var normalizedFormat = typeof format === 'string' ? format.toLowerCase() : '';
  if (normalizedFormat !== 'xml' && normalizedFormat !== 'svg') {
    return false;
  }
  if (!data || typeof data !== 'string') {
    mxUtils.alert(resolveExportFailedMessage());
    return true;
  }
  var ext = normalizedFormat === 'xml' ? 'drawio' : 'svg';
  var mime = normalizedFormat === 'xml' ? 'application/xml' : 'image/svg+xml';
  postExportPayloadToHost({
    format: normalizedFormat,
    filename: ensureFilenameWithExtension(filename || rawFileNameFallback(editorUi), ext),
    mimeType: mime,
    encoding: 'utf8',
    data: data,
  });
  editorUi.hideDialog();
  return true;
}

function exportXml(editorUi, rawName) {
  try {
    stopEditingIfNeeded();
    var xml = mxUtils.getXml(editorUi.editor.getGraphXml());
    postExportPayloadToHost({
      format: 'xml',
      filename: ensureFilenameWithExtension(rawName || rawFileNameFallback(editorUi), 'drawio'),
      mimeType: 'application/xml',
      encoding: 'utf8',
      data: xml,
    });
    editorUi.hideDialog();
  } catch (err) {
    console.warn('exportXml failed', err);
    mxUtils.alert(resolveExportFailedMessage(err));
  }
  return true;
}

function exportSvg(editorUi, rawName, bg, rawScale, rawBorder) {
  try {
    stopEditingIfNeeded();
    var graph = editorUi.editor && editorUi.editor.graph;
    if (!graph || typeof graph.getSvg !== 'function') {
      throw new Error('Graph SVG renderer unavailable');
    }
    var svg = mxUtils.getXml(graph.getSvg(bg, normalizeExportScale(rawScale), normalizeExportBorder(rawBorder)));
    postExportPayloadToHost({
      format: 'svg',
      filename: ensureFilenameWithExtension(rawName || rawFileNameFallback(editorUi), 'svg'),
      mimeType: 'image/svg+xml',
      encoding: 'utf8',
      data: svg,
    });
    editorUi.hideDialog();
  } catch (err) {
    console.warn('exportSvg failed', err);
    mxUtils.alert(resolveExportFailedMessage(err));
  }
  return true;
}

function exportImage(editorUi, rawName, format, bg, rawScale, rawBorder) {
  if (!editorUi || typeof editorUi.exportImage !== 'function') {
    mxUtils.alert(resolveExportFailedMessage());
    return true;
  }
  stopEditingIfNeeded();
  var ext = format === 'jpeg' ? 'jpg' : format;
  var filename = ensureFilenameWithExtension(rawName || rawFileNameFallback(editorUi), ext || 'png');
  var mimeType = format === 'jpeg' || format === 'jpg' ? 'image/jpeg' : 'image/png';
  var transparent = shouldUseTransparentBackground(format, bg);
  var scale = normalizeExportScale(rawScale);
  var border = normalizeExportBorder(rawBorder);
  var resolvedFormat = format === 'jpg' ? 'jpeg' : format;
  var resolved = false;
  var originalHandleError = editorUi.handleError;
  editorUi.handleError = function(error) {
    if (resolved) {
      return;
    }
    resolved = true;
    editorUi.handleError = originalHandleError;
    mxUtils.alert(resolveExportFailedMessage(error));
  };
  try {
    editorUi.exportImage(
      scale,
      transparent,
      true,
      null,
      true,
      border,
      null,
      resolvedFormat,
      function(dataUri) {
        if (resolved) {
          return;
        }
        resolved = true;
        editorUi.handleError = originalHandleError;
        if (!dataUri || typeof dataUri !== 'string') {
          mxUtils.alert(resolveExportFailedMessage());
          return;
        }
        var base64 = extractBase64(dataUri);
        if (!base64) {
          mxUtils.alert(resolveExportFailedMessage());
          return;
        }
        postExportPayloadToHost({
          format: format,
          filename: filename,
          mimeType: mimeType,
          encoding: 'base64',
          data: base64,
        });
      },
    );
    editorUi.hideDialog();
  } catch (err) {
    if (!resolved) {
      resolved = true;
      editorUi.handleError = originalHandleError;
      mxUtils.alert(resolveExportFailedMessage(err));
    }
  }
  return true;
}

function extractBase64(dataUri) {
  if (typeof dataUri !== 'string') {
    return '';
  }
  var commaIndex = dataUri.indexOf(',');
  if (commaIndex === -1) {
    return dataUri;
  }
  return dataUri.substring(commaIndex + 1);
}

function ensureFilenameWithExtension(name, ext) {
  var safeName = typeof name === 'string' && name.trim() ? name.trim() : 'diagram';
  var normalizedExt = typeof ext === 'string' && ext ? ext.toLowerCase() : '';
  if (!normalizedExt) {
    return safeName;
  }
  var lowerName = safeName.toLowerCase();
  if (lowerName.endsWith('.' + normalizedExt)) {
    return safeName;
  }
  var stripped = safeName.replace(/\.+$/, '');
  return stripped + '.' + normalizedExt;
}

function rawFileNameFallback(editorUi) {
  try {
    return editorUi && editorUi.getBaseFilename ? editorUi.getBaseFilename() : 'diagram';
  } catch (err) {
    return 'diagram';
  }
}

function normalizeExportScale(value) {
  var num = Number(value);
  if (!isFinite(num) || num <= 0) {
    return 1;
  }
  return Math.min(Math.max(num, 0.1), 8);
}

function normalizeExportBorder(value) {
  var num = Number(value);
  if (!isFinite(num) || num < 0) {
    return 0;
  }
  return Math.min(num, 500);
}

function shouldUseTransparentBackground(format, bg) {
  if (format === 'jpeg' || format === 'jpg') {
    return false;
  }
  if (bg == null) {
    return true;
  }
  var bgString = String(bg).toLowerCase();
  return bgString === 'none' || bgString === mxConstants.NONE;
}

function resolveExportFailedMessage(error) {
  var reason = error && error.message ? String(error.message) : '';
  if (currentLanguage === 'zh') {
    return reason ? '导出失败：' + reason : '导出失败，请稍后重试。';
  }
  return reason ? 'Export failed: ' + reason : 'Export failed. Please try again.';
}

function resolveUnsupportedFormatMessage() {
  if (currentLanguage === 'zh') {
    return '当前环境暂不支持该导出格式，请改用 PNG、JPEG、SVG 或 XML。';
  }
  return 'This export format is not supported offline. Please use PNG, JPEG, SVG, or XML.';
}

ensureExportIntegration();

(function customizeMenusAndActions() {
  if (typeof Menus !== 'undefined') {
    var filteredDefaults = (Menus.prototype.defaultMenuItems || []).filter(function(item) {
      return item !== 'help';
    });
    Menus.prototype.defaultMenuItems = filteredDefaults;
    if (!fileMenuPatched) {
      var originalMenusInit = Menus.prototype.init;
      Menus.prototype.init = function() {
        originalMenusInit.apply(this, arguments);
        var self = this;
        this.put('file', new Menu(mxUtils.bind(this, function(menu, parent) {
          self.addMenuItems(menu, ['new', 'saveAs', 'export'], parent);
        })));
      };
      fileMenuPatched = true;
    }

    var originalAddMenuItems = Menus.prototype.addMenuItems;
    Menus.prototype.addMenuItems = function(menu, items, parent, evt) {
      if (Array.isArray(items)) {
        items = items.filter(function(item) {
          return item !== 'editData' && item !== 'editData...';
        });
      }
      return originalAddMenuItems.call(this, menu, items, parent, evt);
    };
  }

  if (typeof Format !== 'undefined') {
    var originalAddActions = Format.prototype.addActions;
    Format.prototype.addActions = function(div, actions, title) {
      if (Array.isArray(actions)) {
        actions = actions.filter(function(action) {
          return action !== 'editData' && action !== 'editData...';
        });
      }
      return originalAddActions.call(this, div, actions, title);
    };
  }

  if (typeof Actions !== 'undefined') {
    if (!actionsPatched) {
      var originalActionsInit = Actions.prototype.init;
      Actions.prototype.init = function() {
        originalActionsInit.apply(this, arguments);
        overrideAction(this, 'new', function() {
          requestNewFileFromHost();
        });
        overrideAction(this, 'save', function() {
          requestSaveFromHost();
        });
        overrideAction(this, 'saveAs', function() {
          requestSaveAsFromHost();
        });
        hideAction(this, 'open');
        hideAction(this, 'import');
        hideAction(this, 'pageSetup');
        hideAction(this, 'print');
      };
      actionsPatched = true;
    }

    function overrideAction(instance, key, handler) {
      if (!instance || !instance.actions) return;
      var action = instance.actions[key];
      if (!action) return;
      action.funct = handler;
      action.setEnabled(true);
    }

    function hideAction(instance, key) {
      if (!instance || !instance.actions) return;
      var action = instance.actions[key];
      if (!action) return;
      action.visible = false;
      action.setEnabled(false);
    }
    var originalAddAction = Actions.prototype.addAction;
    Actions.prototype.addAction = function(key, funct, enabled, iconCls, shortcut) {
      if (key === 'editData' || key === 'editData...') {
        var action = originalAddAction.call(this, key, function(){}, false, iconCls, shortcut);
        action.visible = false;
        return action;
      }
      return originalAddAction.call(this, key, funct, enabled, iconCls, shortcut);
    };
  }
})();

(function ensureEmbedDialog() {
  if (typeof window === 'undefined' || typeof window.EmbedDialog === 'function') {
    return;
  }
  window.EmbedDialog = function EmbedDialog(ui, data, _format, _iframe, onConfirm, okLabel, _helpFn, exportLabel) {
    var container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.padding = '12px';

    var textarea = document.createElement('textarea');
    textarea.style.flex = '1';
    textarea.style.width = '100%';
    textarea.style.resize = 'vertical';
    textarea.value = data || '';
    container.appendChild(textarea);

    var footer = document.createElement('div');
    footer.style.marginTop = '12px';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';

    var cancelBtn = mxUtils.button(mxResources.get('cancel'), function() {
      ui.hideDialog();
    });
    cancelBtn.className = 'geBtn';

    var okBtn = mxUtils.button(okLabel || exportLabel || mxResources.get('export'), function() {
      if (typeof onConfirm === 'function') {
        onConfirm(textarea.value);
      }
      ui.hideDialog();
    });
    okBtn.className = 'geBtn gePrimaryBtn';

    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);
    container.appendChild(footer);

    this.container = container;
    this.init = function() {
      textarea.focus();
      textarea.select();
    };
  };
})();

(function ensureConvertImageToDataUri() {
  if (typeof EditorUi === 'undefined' || typeof EditorUi.prototype.convertImageToDataUri === 'function') {
    return;
  }
  EditorUi.prototype.convertImageToDataUri = function(src, callback, errorHandler) {
    try {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function() {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          var dataUri = canvas.toDataURL('image/png');
          callback(dataUri);
        } catch (conversionError) {
          if (typeof errorHandler === 'function') {
            errorHandler(conversionError);
          } else {
            callback(src);
          }
        }
      };
      img.onerror = function(err) {
        if (typeof errorHandler === 'function') {
          errorHandler(err);
        } else {
          callback(src);
        }
      };
      img.src = src;
    } catch (err) {
      if (typeof errorHandler === 'function') {
        errorHandler(err);
      } else {
        callback(src);
      }
    }
  };
})();

(function ensureOfflineMode() {
  if (typeof EditorUi === 'undefined') {
    return;
  }
  if (typeof EditorUi.prototype.isOffline === 'undefined') {
    EditorUi.prototype.isOffline = function() {
      return true;
    };
  }
})();

(function disableBeforeUnloadPrompt() {
  if (typeof EditorUi === 'undefined') {
    return;
  }
  EditorUi.prototype.addBeforeUnloadListener = function() {};
  EditorUi.prototype.onBeforeUnload = function() {};
})();

function normalizeLanguage(language) {
  if (typeof language !== 'string' || !language) return null;
  if (/^zh(-|_)?/i.test(language)) {
    return 'zh';
  }
  return language;
}

function applyLightTheme() {
  if (darkThemeLink) {
    darkThemeLink.disabled = true;
  }
  document.documentElement.removeAttribute('data-theme');
  document.body.classList.remove('drawio-dark');
  Editor.darkMode = false;
  if (window.editorUIInstance) {
    try {
      editorUIInstance.fireEvent(new mxEventObject('darkModeChanged'));
      editorUIInstance.refresh(true);
      editorUIInstance.editor.graph.refresh();
    } catch (error) {
      console.warn('applyLightTheme failed', error);
    }
  }
  currentTheme = 'light';
}

function applyDarkTheme() {
  if (darkThemeLink) {
    darkThemeLink.disabled = false;
  }
  document.documentElement.setAttribute('data-theme', 'dark');
  document.body.classList.add('drawio-dark');
  Editor.darkMode = true;
  if (window.editorUIInstance) {
    try {
      editorUIInstance.fireEvent(new mxEventObject('darkModeChanged'));
      editorUIInstance.refresh(true);
      editorUIInstance.editor.graph.refresh();
    } catch (error) {
      console.warn('applyDarkTheme failed', error);
    }
  }
  currentTheme = 'dark';
}

function getExportBackground() {
  return '#ffffff';
}

function graphHasRenderableContent(editor) {
  try {
    if (!editor || !editor.graph || !editor.graph.model) {
      return false;
    }
    var graph = editor.graph;
    var parent = graph.getDefaultParent && graph.getDefaultParent();
    if (!parent) {
      parent = graph.model.getRoot ? graph.model.getRoot() : graph.model.root;
    }
    if (!parent) {
      return false;
    }
    var hasVertices = false;
    if (typeof graph.getChildVertices === 'function') {
      var vertices = graph.getChildVertices(parent);
      hasVertices = Array.isArray(vertices) && vertices.length > 0;
    }
    if (hasVertices) {
      return true;
    }
    if (typeof graph.getChildEdges === 'function') {
      var edges = graph.getChildEdges(parent);
      if (Array.isArray(edges) && edges.length > 0) {
        return true;
      }
    }
    var model = graph.model;
    if (typeof model.getChildCount !== 'function' || typeof model.getChildAt !== 'function') {
      return false;
    }
    var childCount = model.getChildCount(parent);
    for (var i = 0; i < childCount; i++) {
      var child = model.getChildAt(parent, i);
      if (child && model.getChildCount(child) > 0) {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.warn('graphHasRenderableContent failed', err);
    return true;
  }
}

function postDrawioData(xmlData, base64) {
  window.parent.postMessage(
    {
      mceAction: 'getData:success',
      eventName: 'getData:success',
      value: {
        xmlData: xmlData,
        base64: base64 || TRANSPARENT_PIXEL,
      },
    },
    '*',
  );
}

function exportDiagramImageSafe(onSuccess, onError) {
  if (!window.editorUIInstance || typeof window.editorUIInstance.exportImage !== 'function') {
    if (typeof onError === 'function') {
      onError(new Error('exportImage is unavailable'));
    }
    return;
  }
  var ui = window.editorUIInstance;
  var resolved = false;
  var originalHandleError = ui.handleError;
  ui.handleError = function(error) {
    if (resolved) {
      return;
    }
    resolved = true;
    ui.handleError = originalHandleError;
    if (typeof onError === 'function') {
      onError(error);
    }
  };
  try {
    ui.exportImage(1, getExportBackground(), true, null, true, 50, null, 'png', function(base64) {
      if (resolved) {
        return;
      }
      resolved = true;
      ui.handleError = originalHandleError;
      if (typeof onSuccess === 'function') {
        onSuccess(base64);
      }
    });
  } catch (error) {
    if (resolved) {
      return;
    }
    resolved = true;
    ui.handleError = originalHandleError;
    if (typeof onError === 'function') {
      onError(error);
    }
  }
}

// Extends EditorUi to update I/O action states based on availability of backend
(function()
{
  var editorUiInit = EditorUi.prototype.init;
	
	EditorUi.prototype.init = function()
	{
		editorUiInit.apply(this, arguments);
	};
	
	// Adds required resources (disables loading of fallback properties, this can only
	// be used if we know that all keys are defined in the language specific file)
	mxResources.loadDefaultBundle = false;
	var bundle = './assets/drawio_lib/resources/' + mxLanguage + '.txt';
	
	// Fixes possible asynchronous requests
	mxUtils.getAll([bundle, './assets/drawio_lib/theme/default.xml'], function(xhr)
	{
		// Adds bundle text to resources
		mxResources.parse(xhr[0].getText());
		
		// Configures the default graph theme
		var themes = new Object();
		themes[Graph.prototype.defaultThemeName] = xhr[1].getDocumentElement(); 
		
		// Main
    window.editorUIInstance = new EditorUi(new Editor(false, themes));
    if (currentTheme === 'dark') {
      applyDarkTheme();
    } else {
      applyLightTheme();
    }
    
    try {
      addPostMessageListener(editorUIInstance.editor);
    } catch (error) {
      console.log(error);
    }
  window.parent.postMessage({eventName: 'ready', value: ''}, '*');

	}, function()
	{
		document.body.innerHTML = '<center style="margin-top:10%;">Error loading resource files. Please check browser console.</center>';
    notifyFatal('draw.io 资源加载失败');
	});
})();

function captureDiagramXml(graphEditor) {
  try {
    if (!graphEditor) {
      return null;
    }
    var editor = graphEditor;
    if (editor.graph && typeof editor.graph.stopEditing === 'function') {
      editor.graph.stopEditing(false);
    }
    return mxUtils.getXml(editor.getGraphXml());
  } catch (err) {
    console.warn('captureDiagramXml failed', err);
    return null;
  }
}

function addPostMessageListener(graphEditor) {
  var dirtyNotifyTimer = null;
  function scheduleDirtyNotification() {
    if (dirtyNotifyTimer != null) {
      return;
    }
    dirtyNotifyTimer = setTimeout(function() {
      dirtyNotifyTimer = null;
      var payload = null;
      try {
        var snapshot = captureDiagramXml(graphEditor);
        if (typeof snapshot === 'string' && snapshot.length) {
          payload = {xmlData: snapshot};
        }
      } catch (err) {
        console.warn('snapshot capture failed', err);
      }
      try {
        var message = {eventName: 'content-changed'};
        if (payload) {
          message.value = payload;
        }
        window.parent.postMessage(message, '*');
      } catch (err) {
        console.warn('content-changed postMessage failed', err);
      }
    }, 200);
  }

  window.addEventListener('message', function(event) {
    if(!event.data || !event.data.eventName) {
        return 
    }
    switch (event.data.eventName) {
      case 'setData':
        try {
          var value = event.data.value;
          var doc = mxUtils.parseXml(value);
          var documentName = 'cherry-drawio-' + new Date().getTime();
          editorUIInstance.editor.setGraphXml(null);
          graphEditor.graph.importGraphModel(doc.documentElement);
          graphEditor.setFilename(documentName);
          window.parent.postMessage({eventName: 'setData:success', value: ''}, '*');
        } catch (error) {
          console.error('setData failed', error);
          notifyFatal('draw.io 导入失败: ' + (error && error.message ? error.message : '未知错误'));
        }
        break;
      case 'getData':
        try {
          editorUIInstance.editor.graph.stopEditing();
          var xmlData = mxUtils.getXml(editorUIInstance.editor.getGraphXml());
          if (!graphHasRenderableContent(editorUIInstance.editor)) {
            postDrawioData(xmlData, TRANSPARENT_PIXEL);
            break;
          }
          exportDiagramImageSafe(
            function(base64) {
              if (!base64 || base64.length <= 32) {
                postDrawioData(xmlData, TRANSPARENT_PIXEL);
                return;
              }
              postDrawioData(xmlData, base64);
            },
            function(error) {
              console.warn('exportImage failed, fallback to placeholder', error);
              postDrawioData(xmlData, TRANSPARENT_PIXEL);
            },
          );
        } catch (error) {
          console.error('exportImage failed', error);
          notifyFatal('draw.io 导出失败: ' + (error && error.message ? error.message : '未知错误'));
        }
        break;
      case 'configure':
        var config = event.data.value || {};
        if (typeof config.language === 'string') {
          document.documentElement.setAttribute('lang', config.language);
          var normalized = normalizeLanguage(config.language) || currentLanguage;
          currentLanguage = normalized;
          mxLanguage = normalized;
          mxLanguages = [normalized];
        }
        if (typeof config.theme === 'string') {
          var nextTheme = String(config.theme).toLowerCase() === 'dark' ? 'dark' : 'light';
          if (nextTheme !== currentTheme) {
            if (nextTheme === 'dark') {
              applyDarkTheme();
            } else {
              applyLightTheme();
            }
          }
        }
        break;
      case 'ready?':
        window.parent.postMessage({eventName: 'ready', value: ''}, '*');
        break;
      default:
        break;
    }
  });

  try {
    var model = graphEditor && graphEditor.graph ? graphEditor.graph.getModel() || graphEditor.graph.model : null;
    if (model && typeof model.addListener === 'function' && typeof mxEvent !== 'undefined') {
      model.addListener(mxEvent.CHANGE, function() {
        scheduleDirtyNotification();
      });
    }
  } catch (err) {
    console.warn('Failed to attach content change listener', err);
  }
}
