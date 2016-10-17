// Parser for TypeScript-style definition files
//
// Takes a TypeScript file as, for example, found in
// github.com/borisyankov/DefinitelyTyped , and spits out Tern type
// description JSON data.

var fs = require("fs");
var ts = require('typescript');

var nt = ts.SyntaxKind;

var definitions;

function parseFile(text, name) {
  return ts.createSourceFile(name, text, ts.ScriptTarget.ES6, /*setParentNodes*/ true);
}

function lookup(name, cx) {
  for (; cx; cx = cx.prev)
    if (cx.name == name) return cx.value;
}

function buildPath(cx) {
  for (var path = ""; cx; cx = cx.prev) {
    var part = cx.enter && cx.enter.replace(/[^\w$]/g, "");
    if (part) path = path ? part + "." + path : part;
  }
  return path;
}

function merge(obj1, obj2) {
  for (var key in obj2) {
    if (obj2.hasOwnProperty(key)) {
      obj1[key] = obj2[key];
    }
  }
}

function functionType(node, cx) {
  var type = "fn(";
  var args = node.parameters;;

  for (var i = 0; i < args.length; ++i) {
    var arg = args[i];
    if (i) type += ", ";
    var name = arg.name.text;
    if (arg.questionToken) name += "?";
    type += name + ": " + walk_(arg.type, {enter: name, prev: cx});
  }
  type += ")";
  var ret = node.type;
  if (ret && ret.kind != nt.VoidKeyword) // FIXME filter out void
    type += " -> " + flat(ret, {enter: "!ret", prev: cx});
  return type;
}

function addToObj(data, identifier, val) {
  var name = identifier.text;
  if (/^".*"$/.test(name)) name = name.slice(1, name.length - 1);
  var known = data[name];
  if (known) {
    if (typeof known != "string" && typeof val == "string" && !known["!type"]) {
      known["!type"] = val;
    } else if (typeof known == "string" && typeof val != "string") {
      data[name] = val;
      val["!type"] = known;
    } else if (Object.prototype.toString.call(known) == '[object Object]') {
      merge(known, val);
    }
  } else {
    data[name] = val;
  }
}

function isStatic(node) {
  return false;
  // FIXME: Need to find example of static properties and figure out what to do
  //if (node.modifiers) for (var i = 0, e = node.modifiers.childCount(); i < e; i++)
    //if (node.modifiers.childAt(i).value() == "static") return true;
}

function objType(node, cx, cls) {
  var data = {};
  ts.forEachChild(node, function(n) {
    var target = cls && isStatic(n) ? cls : data;
    switch (n.kind) {
      case nt.ImportDeclaration:
        // TODO: Implement this
        //var mod = flat(field.moduleReference(), cx);
        //cx = {name: field.identifier.text(), value: mod, prev: cx};
        break;
      case nt.FunctionDeclaration:
        addToObj(target, n.name, functionType(n, cx));
        break;
      case nt.MethodSignature:
        // TODO: Implement this
        //addToObj(target, field.propertyName, functionType(field.callSignature, cx));
        break;
      case nt.ModuleDeclaration:
        addToObj(target, n.name || n.stringLiteral, objType(n.body, cx));
        break;
      case nt.InterfaceDeclaration:
        // TODO: Implement this
        //addToObj(target, field.identifier, objType(field.body.typeMembers, cx));
        break;
      case nt.ClassDeclaration:
        // TODO: Implement this
        //var inner = {};
        //inner.prototype = objType(field.classElements, cx, inner);
        //addToObj(target, field.identifier, inner);
        break;
      case nt.PropertySignature:
        // TODO: Implement this
        //addToObj(target, field.propertyName, walk_(field.typeAnnotation, cx));
        break;
      case nt.EnumDeclaration:
        // TODO: Implement this
        //addToObj(target, field.identifier, "number");
        break;
      case nt.VariableStatement:
        // TODO: Implement this
        //var decls = field.variableDeclaration.variableDeclarators;
        //for (var j = 0, ej = decls.childCount(); j < ej; j++) {
        //  var decl = decls.childAt(j);
        //  addToObj(target, decl.propertyName, walk_(decl.typeAnnotation, cx));
        //}
        break;
      case nt.Constructor:
        // TODO: Implement this
        //if (cls && !cls["!type"]) cls["!type"] = functionType(field, cx);
        break;
      case nt.ExportAssignment:
        // "export = " means to make the whole module whatever the assignment is
        //return walk(n, cx);
      // FIXME not sure what these are doing in declaration files
      case nt.CallSignature:
      case nt.ConstructSignature:
      case nt.IndexSignature:
      case nt.SemicolonToken:
      case nt.EmptyStatement:
      case nt.EndOfFileToken:
        break;
      default:
        throw new Error("Unknown field type: " + nt[n.kind]);
    }
  });
  return data;
}

function walk(node, cx) {
  switch (node.kind) {
  case nt.IdentifierName:
    return lookup(node.text(), cx) || node.text();
  case nt.QualifiedName:
    return flat(node.left, cx) + "." + flat(node.right, null);
  case nt.ObjectType:
    return objType(node.typeMembers, cx);
  case nt.ArrayType:
    return "[" + flat(node.type, cx) + "]";
  case nt.FunctionType:
    return functionType(node, cx);
  case nt.DotToken:
    return flat(node.operand1, cx) + "." + flat(node.operand2, cx);
  case nt.StringLiteral:
  case nt.StringKeyword:
    return "string";
  case nt.NumberKeyword:
    return "number";
  case nt.BooleanKeyword:
    return "bool";
  case nt.AnyKeyword:
  case nt.VoidKeyword:
  case nt.GenericType:
    return "?";
  case nt.TypeQuery:
    return walk(node.name);
  case nt.FirstTypeScriptKeyword:
  case nt.LastTypeScriptKeyword:
  case nt.FirstKeyword:
  case nt.LastKeyword:
    return node.value();
  default:
    throw new Error("Unrecognized type: " + nt[node.kind]);
  }
}

function walk_(typeAnn, cx) {
  if (typeAnn) return walk(typeAnn, cx);
  return "?";
}

function flat(node, cx) {
  var type = walk(node, cx);
  if (typeof type == "string") return type;
  var name = buildPath(cx);
  for (var i = 0; ; ++i) {
    var uniq = name + (i || "");
    if (!definitions.hasOwnProperty(uniq)) { name = uniq; break; }
  }
  definitions[name] = type;
  return name;
}

var defaultCx = {name: "any", value: "?", prev: {name: "null", value: "?", prev: null}};

exports.translate = function(text, name) {
  definitions = {};
  var tree = parseFile(text, name);
  var data = objType(tree, defaultCx);
  data["!name"] = name;
  var hasDefs = false;
  for (var _d in definitions) { hasDefs = true; break; }
  if (hasDefs) data["!define"] = definitions;
  return data;
};
