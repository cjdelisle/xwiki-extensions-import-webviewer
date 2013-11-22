/* -*- Mode: java; tab-width: 4; indent-tabs-mode: nil; -*- */
import java.util.Map;
import java.util.HashMap;
import groovy.util.XmlSlurper;

static Map getAttributes(String name)
{
    String prefix = "http://webviewers.org/xwiki/rest/wikis/xwiki/spaces/Viewers/pages/";
    String suffix = "/objects/Viewers.ViewersClass/1/properties";
    def obj = new XmlSlurper().parseText(new URL(prefix+name+suffix).getText());
    Map out = new HashMap();
    for (int i = 0; i < 15; i++) {
        out.put(""+obj.property[i].attribute[0].@value, ""+obj.property[i].value);
    }
    return out;
}

static String getDownloadLink(String name)
{
    return "http://webviewers.org/xwiki/bin/export/Viewers/" +
        name + "?format=xar&name=Viewers." + name + "&pages=Viewers." + name;
}

public String main(String name, String user, String password, Object xcontext)
{
    Map attributes = getAttributes(name);
    String downloadLink = getDownloadLink(name);

    String version = "0.1.0";
    if (attributes.get("wrapperVersion") != null) {
        version = ""+attributes.get("wrapperVersion");
    } else if (attributes.get("version") != null) {
        version = ""+attributes.get("version");
    }
    String fileName = "webviewer-" + name + "-" + version + ".xar";

    def xc = xcontext.getContext();
    def wiki = xc.getWiki();
    def doc = wiki.getDocument("Extension", name+" webviewer", xc);
    doc.setParent("Extension.WebHome");
    doc.setAuthor(xc.getUser());
    doc.setContentAuthor(xc.getUser());
    doc.setCreator(xc.getUser());
    def ext = doc.getObject("ExtensionCode.ExtensionClass", true, xc);
    ext.set("id", "webviewer:" + name, xc);
    ext.set("name", name, xc);
    ext.set("summary", attributes.get("description"), xc);
    ext.set("description", "Imported from http://webviewers.org/xwiki/bin/view/Viewers/" + name, xc);
    ext.set("source", attributes.get("sourcecodeurl"), xc);
    ext.set("type", "xar", xc);
    ext.set("website", attributes.get("url"), xc);
    ext.set("licenseName", attributes.get("licence"), xc);
    ext.set("lastVersion", version, xc);
    ext.set("validExtension", 1, xc);
    String authors = ""+attributes.get("developer");
    if (attributes.get("wrapperDeveloper") != null) {
        authors += ("".equals(authors)) ? "" : "|";
        authors += attributes.get("wrapperDeveloper");
    }
    ext.set("authors", authors, xc);


    def dep = doc.getObject("ExtensionCode.ExtensionDependencyClass", true, xc);
    dep.set("id", "calebjamesdelisle:webviewers", xc);
    dep.set("extensionVersion", version, xc);
    dep.set("constraint", "1.0", xc);


    def extVer = doc.getObject("ExtensionCode.ExtensionVersionClass", true, xc);
    extVer.set("version", version, xc);
    extVer.set("download", "attach:"+fileName, xc);

    def conn = downloadLink.toURL().openConnection();
    def authString = (user + ":" + password).getBytes().encodeBase64().toString();
    conn.setRequestProperty("Authorization", "Basic " + authString);
    conn.connect();
    if(conn.getResponseCode() != 200 || conn.getContentType().indexOf("application/zip") == -1) {
        String message = "";
        if (conn.getResponseCode() != 200) {
            message = conn.getResponseMessage();
        } else {
            def inStream = conn.getInputStream();
            message = "{{html clean=false}}";
            for (String line : inStream.readLines()) {
                message += line + "\n";
            }
            message += "{{/html}}";
            inStream.close();
        }
        return "HTTP_ERROR " + message;
    }
    doc.addAttachment(fileName, conn.getInputStream(), xc);

    wiki.saveDocument(doc, xc);

    return "SUCCESS [[" + doc.getFullName() + "]]";
}
