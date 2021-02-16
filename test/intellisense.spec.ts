import * as assert from "assert";
import { debug } from "console";
import 'mocha';
import { SyntaxNode } from "web-tree-sitter";
import { findFunctionCallRootAtPosition, findIndexRootAtPosition, findNodeAbove, findNodeBeforeOrBelow, getSymbolParts } from "../server/intellisense";
import { TreeSitterDocument } from "../server/tree-sitter-document";
import { beautify } from "./sexpr";

async function getTestDocument(text: string) {
    const result = new TreeSitterDocument();
    await result.init("./test.tl", text);

    return result;
}

function debugNode(doc: TreeSitterDocument, node: SyntaxNode) {
    console.log("Tree dump:", beautify(doc.dumpTree()));
    console.log("Node at position:", beautify(node.toString()), "[", node.text, "]");
    console.log("Its parent:", beautify(node.parent?.toString()), "[", node.parent?.text, "]");
    console.log("Index node above:", findNodeAbove(node, ["index", "method_index"])?.text);

    if (node.type === "ERROR") {
        console.log("Index node next or below (error node detected):", findNodeBeforeOrBelow(node, ["index", "method_index"])?.text);
    }
}

async function expressionSplitTest(code: string, y: number, x: number, expected: string[]) {
    const doc = await getTestDocument(code);

    const indexRoot = findIndexRootAtPosition(doc, y, x);

    assert(indexRoot !== null);

    assert.deepStrictEqual(getSymbolParts(indexRoot, y, x), expected);
}

describe("Splitting an expression into parts", () => {
    it('works with partial input after a single ":"', async () => {
        const code = `abc:`;
        await expressionSplitTest(code, 0, 4, ["abc"]);
    });
    it('works with partial input after a single "."', async () => {
        const code = `abc.`;
        await expressionSplitTest(code, 0, 4, ["abc"]);
    });
    it('works with partial input after a second "."', async () => {
        const code = `abc.efg.`;
        await expressionSplitTest(code, 0, 8, ["abc", "efg"]);
    });
    it('works with complete input after a second "."', async () => {
        const code = `abc.efg.hij`;
        await expressionSplitTest(code, 0, 11, ["abc", "efg"]);
    });
    it('works with partial input after a ".", after a function call', async () => {
        const code = `abc().`;
        await expressionSplitTest(code, 0, 6, ["abc"]);
    });
    it('works with partial input after a ".", next to a function call with arguments', async () => {
        const code = `abc(def, ghi.jkl).mno.`;
        await expressionSplitTest(code, 0, 22, ["abc", "mno"]);
    });
    it('works with partial input after a ".", inside a function call', async () => {
        const code = `abc(def, ghi.).mno`;
        await expressionSplitTest(code, 0, 13, ["ghi"]);
    });
    it('works with partial input after a "." in a nested function call', async () => {
        const code = `abc(def, ghi.ijk(lmn, opq.rst.)).mno`;
        await expressionSplitTest(code, 0, 30, ["opq", "rst"]);
    });
    it('works with complete input after a "." in a nested function call', async () => {
        const code = `abc(def, ghi.ijk(lmn, opq.rst.uvw)).mno`;
        await expressionSplitTest(code, 0, 33, ["opq", "rst"]);
    });
    it('works with partial input after an array access', async () => {
        const code = `abc[1].`;
        await expressionSplitTest(code, 0, 7, ["abc"]);
    });
    it('works with partial input after two successive function calls', async () => {
        const code = `abc.efg(hij)(klm).nop.`;
        await expressionSplitTest(code, 0, 22, ["abc", "efg", "nop"]);
    });
    it('works with complete input after two successive function calls', async () => {
        const code = `abc.efg(hij)(klm).nop.qrs`;
        await expressionSplitTest(code, 0, 25, ["abc", "efg", "nop"]);
    });
    it('works inside a table literal', async () => {
        const code = `local x = { abc. }`;
        const doc = await getTestDocument(code);

        const indexRoot = findIndexRootAtPosition(doc, 0, 16);
    
        assert(indexRoot !== null);
    
        assert.deepStrictEqual(getSymbolParts(indexRoot, 0, 16), ["abc"]);
    });
    it('index root on single element expression is null', async () => {
        const code = `abc()`;
        const doc = await getTestDocument(code);

        const indexRoot = findIndexRootAtPosition(doc, 0, 3);

        assert(indexRoot === null);
    });
});

describe("Splitting a function call into parts", () => {
    it("works without indexes ", async () => {
        const code = `abc()`;
        const doc = await getTestDocument(code);

        const functionCallRoot = findFunctionCallRootAtPosition(doc, 0, 4);

        assert(functionCallRoot !== null);

        const calledObject = functionCallRoot.childForFieldName("called_object");

        assert(calledObject !== null);

        const symbolParts = getSymbolParts(calledObject, calledObject.endPosition.row, calledObject.endPosition.column + 1);

        assert.deepStrictEqual(symbolParts, ["abc"]);
    });
    it("works with indexes ", async () => {
        const code = `abc.efg()`;
        const doc = await getTestDocument(code);

        const functionCallRoot = findFunctionCallRootAtPosition(doc, 0, 8);

        assert(functionCallRoot !== null);

        const calledObject = functionCallRoot.childForFieldName("called_object");

        assert(calledObject !== null);
        
        const symbolParts = getSymbolParts(calledObject, calledObject.endPosition.row, calledObject.endPosition.column + 1);

        assert.deepStrictEqual(symbolParts, ["abc", "efg"]);
    });
    it("doesn't get confused by function arguments", async () => {
        const code = `abc.efg(hij, klm.nop)`;
        const doc = await getTestDocument(code);

        const functionCallRoot = findFunctionCallRootAtPosition(doc, 0, 20);

        assert(functionCallRoot !== null);

        const calledObject = functionCallRoot.childForFieldName("called_object");

        assert(calledObject !== null);
        
        const symbolParts = getSymbolParts(calledObject, calledObject.endPosition.row, calledObject.endPosition.column + 1);

        assert.deepStrictEqual(symbolParts, ["abc", "efg"]);
    });
    it("works when nested inside a function", async () => {
        const code = `abc.efg(hij.klm(), nop)`;
        const doc = await getTestDocument(code);

        const functionCallRoot = findFunctionCallRootAtPosition(doc, 0, 16);

        assert(functionCallRoot !== null);

        const calledObject = functionCallRoot.childForFieldName("called_object");

        assert(calledObject !== null);
        assert(calledObject.childForFieldName("called_object") === null);

        const symbolParts = getSymbolParts(calledObject, calledObject.endPosition.row, calledObject.endPosition.column + 1);

        assert.deepStrictEqual(symbolParts, ["hij", "klm"]);
    });
    it("works when the function call is preceded by another function call", async () => {
        const code = `abc.efg()()`;
        const doc = await getTestDocument(code);

        const functionCallRoot = findFunctionCallRootAtPosition(doc, 0, 10);

        assert(functionCallRoot !== null);

        const calledObject = functionCallRoot.childForFieldName("called_object");

        assert(calledObject !== null);
        assert(calledObject.childForFieldName("called_object") !== null);

        /* 
            TODO:
            if (calledObject.childForFieldName("called_object") !== null) {
                <The function call is preceded by another function call; use the return type of the previous function for the signature> 
            } 
        */

        const symbolParts = getSymbolParts(calledObject, calledObject.endPosition.row, calledObject.endPosition.column + 1);

        assert.deepStrictEqual(symbolParts, ["abc", "efg"]);
    });
});