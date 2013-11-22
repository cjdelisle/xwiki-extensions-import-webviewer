var XWiki = require('xwiki-tools');
var nThen = require('nthen');
var Fs = require('fs');
var Os = require('os');
var XMHell = require('xmhell');

//---------------------- Create XWiki Package ----------------------//

// TODO: make this generic
var pack = new XWiki.Package();
pack.setName("XWiki - Contrib - Import WebViewer");
pack.setDescription("A tool for importing WebViewers from webviewers.org into extensions.xwiki.org");
pack.setExtensionId("org.xwiki.contrib:xwiki-contrib-importviewers");



var SOURCE_DIR = 'src/xwiki';

var handleAttachmentDir = function (doc, dir, waitFor)
{
    var dirName = 'attachments';
    Fs.stat(dir+'/'+dirName, waitFor(function (err, stat) {
        if (err) {
            if (err.code === 'ENOENT') { return; }
            throw err;
        }
        if (!stat.isDirectory()) { return; }
        Fs.readdir(dir+'/'+dirName, waitFor(function (err, attachments) {
            if (err) { throw err; }
            attachments.forEach(function (attach) {
                console.log("attachment "+dir+'/'+dirName+'/'+attach);
                doc.addAttachment(dir+'/'+dirName+'/'+attach);
            });
        }));
    }));
};

var execute = function (name, content, funcName, args, callback)
{
    var to = setTimeout(function () {
        throw new Error("[" + name + "] did not complete execution in 10 seconds");
    }, 10000);
    var xx = function (f) {
        f.apply(null, args);
        clearTimeout(to);
        callback();
    };
    eval('function '+funcName+'(f) { xx(f); } ' + content);
};

var handleObjectDir = function (doc, dir, waitFor)
{
    var dirName = 'objects';
    Fs.stat(dir+'/'+dirName, waitFor(function (err, stat) {
        if (err) {
            if (err.code === 'ENOENT') { return; }
            throw err;
        }
        if (!stat.isDirectory()) { return; }
        Fs.readdir(dir+'/'+dirName, waitFor(function (err, objects) {
            if (err) { throw err; }
            objects.forEach(function (objName) {
                console.log("obj "+dir+'/'+dirName+'/'+objName);
                var className = objName.replace(/_[0-9]*$/, '');
                var space = className.split('.')[0];
                var name = className.split('.')[1];
                if (typeof(name) === 'undefined') {
                    name = space;
                    space = undefined;
                }
                var Clazz;
                if (typeof(XWiki.model.classes[space]) !== 'undefined'
                    && typeof(XWiki.model.classes[space][name]) !== 'undefined')
                {
                    Clazz = XWiki.model.classes[space][name];
                } else if (typeof(XWiki.model.classes[name]) !== 'undefined') {
                    Clazz = XWiki.model.classes[name];
                } else {
                    throw new Error("could not find class [" + space + '.' + name + "]");
                }
                var obj = new Clazz();
                doc.addXObject(obj);
                Fs.readdir(dir+'/'+dirName+'/'+objName, waitFor(function (err, props) {
                    if (err) { throw err; }
                    var addProp = function (prop) {
                        if (prop === 'this.js') { return; }
                        var setter = 'set' +
                            prop[0].toUpperCase() +
                            prop.replace(/\.[^\.]*$/,'').substring(1);
                        obj[setter](
                            XWiki.Tools.contentFromFile(dir+'/'+dirName+'/'+objName+'/'+prop)
                        );
                    };
                    if (props.indexOf('this.js') !== -1) {
                        Fs.readFile(dir+'/'+dirName+'/'+objName+'/'+'this.js', waitFor(function (err, content) {
                            if (err) { throw err; }
                            execute(dir+'/'+dirName+'/'+objName+'/'+'this.js',
                                    content.toString(),
                                    'XWikiObj',
                                    [obj, XWiki],
                                    waitFor(function () {
                                        props.forEach(addProp);
                                    })
                            );
                        }));
                    } else {
                        props.forEach(addProp);
                    }
                }));
            });
        }));
    }));
};

var handleDocDir = function (doc, sourceDir, space, page, waitFor)
{
    var dir = sourceDir+'/'+space+'/'+page;
    console.log("document "+dir);
    var done = function (names) {
        names.forEach(function (name) {
            if (/this\.[^\.]*$/.test(name)) { return; }
            Fs.stat(dir+'/'+name, function (err, stat) {
                if (err) { throw err; }
                if (stat.isDirectory()) { return; }
                var cName = name[0].toUpperCase() + name.replace(/\.[^\.]*$/, '').substring(1);
                if (typeof(doc['set' + cName]) === 'undefined') {
                    console.log("WARNING: no method XWikiDoc.set" + cName + "() ignoring [" + dir+'/'+name + "]");
                    return;
                }
                Fs.readFile(dir+'/'+name, waitFor(function (err, content) {
                    if (err) { throw err; }
                    doc['set' + cName](content.toString());
                }));
            });
        });
        handleAttachmentDir(doc, dir, waitFor);
        handleObjectDir(doc, dir, waitFor);
    };
    Fs.stat(dir, waitFor(function (err, stat) {
        if (err) { throw err; }
        if (!stat.isDirectory()) { return; }
        Fs.readdir(dir, waitFor(function (err, names) {
            if (names.indexOf('this.js') !== -1) {
                if (names.indexOf('this.xml') !== -1) {
                    throw new Error(dir + ' cannot have both this.js and this.xml');
                }
                Fs.readFile(dir+'/'+'this.js', waitFor(function (err, content) {
                    if (err) { throw err; }
                    execute(dir+'/'+'this.js', content.toString(), 'XWikiDoc', [doc, XWiki], waitFor(function () {
                        done(names);
                    }));
                }));
            } else if (names.indexOf('this.xml') !== -1) {
                Fs.readFile(dir+'/'+'this.xml', waitFor(function (err, content) {
                    if (err) { throw err; }
                    var json = XMHell.parse(content.toString());
                    doc.fromJSON(json);
                    done(names);
                }));
            } else {
                done(names);
            }
        }));
    }));
};

var checkDupes = function (pages)
{
    var pagesHash = {};
    pages.forEach(function (page) {
        var pageNoExtent = page.replace(/\.[^\.]*$/,'');
        if (typeof(pagesHash[pageNoExtent]) !== 'undefined') {
            throw new Error("duplicate " + page + " " + pageNoExtent);
        }
        pagesHash[pageNoExtent] = page;
    });
};

//---------------------- Main ----------------------//
nThen(function(waitFor) {

    Fs.readdir(SOURCE_DIR, waitFor(function (err, spaces) {
        spaces.forEach(function (space) {
            Fs.readdir(SOURCE_DIR+'/'+space, waitFor(function (err, pages) {
                checkDupes(pages);
                pages.forEach(function (page) {
                    if (/\.js$/.test(page)) {
                        Fs.readFile(SOURCE_DIR+'/'+space+'/'+page, waitFor(function (err, content) {
                            if (err) { throw err; }
                            var doc = new XWiki.model.XWikiDoc([space, page.replace(/\.[^\.]*$/, '')]);
                            execute(SOURCE_DIR+'/'+space+'/'+page, content.toString(), 'XWikiDoc', [doc, XWiki], waitFor());
                            pack.addDocument(doc);
                        }));
                        return;
                    }
                    if (!(/\.xml$/.test(page))) {
                        Fs.stat(SOURCE_DIR+'/'+space+'/'+page, waitFor(function (err, stat) {
                            if (err) { throw err; }
                            if (!stat.isDirectory()) { return; }
                            var doc = new XWiki.model.XWikiDoc([space, page]);
                            handleDocDir(doc, SOURCE_DIR, space, page, waitFor);
                            pack.addDocument(doc);
                        }));
                        return;
                    }
                    Fs.readFile(SOURCE_DIR+'/'+space+'/'+page, waitFor(function(err, data) {
                        if (err) { throw err; }
                        var json = XMHell.parse(data.toString());
                        var doc = new XWiki.model.XWikiDoc([space, page.replace(/\.[^\.]*$/, '')]);
                        doc.fromJSON(json);
                        pack.addDocument(doc);
                    }));
                });
            }));
        });
    }));

}).nThen(function(waitFor) {

//---------------------- Package it up ----------------------//

    // Post to a wiki?
    // must post to a /preview/ page, for example:
    // syntax  ./do --post Admin:admin@192.168.1.1:8080/xwiki/bin/preview//
    var i;
    if ((i = process.argv.indexOf('--post')) > -1) {
        pack.postToWiki(process.argv[i+1]);

    } else if ((i = process.argv.indexOf('--mvn')) > -1) {
        pack.genMvn('mvnout');

    } else {
        pack.genXar('xwiki-extension-import-webviewer.xar');
    }

});
