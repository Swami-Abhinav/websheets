function ExpressionToken(type, value) {
    this.type = type;
    this.value = value;
}

function ExpressionNode(type, params) {
    this.type = type;
    for (var i in params) {
        this[i] = params[i];
    }
}

ExpressionNode.prototype.walk = function(cb) {
    if (cb(this) === false) return;
    switch (this.type) {
        case 'range':
            this.start.walk(cb);
            this.end.walk(cb);
            return;
        case 'function':
            this.args.forEach(function(arg) {
                arg.walk(cb);
            });
            return;
        case 'sheetlookup':
            this.content.walk(cb);
            return;
        case 'binop_mult':
        case 'binop_div':
        case 'binop_add':
        case 'binop_sub':
        case 'binop_concat':
        case 'binop_expon':
            this.left.walk(cb);
            this.right.walk(cb);
    }
};

ExpressionNode.prototype.toString = function() {
    switch (this.type) {
        case 'boolean': return this.value ? 'true' : 'false';
        case 'string': return JSON.stringify(this.value);
        case 'number': return this.raw.toString();
        case 'identifier': return this.raw.toUpperCase();
        case 'sheetlookup': return this.sheet + '!' + this.content.toString();
        case 'range': return this.start.toString() + ':' + this.end.toString();
        case 'function': return this.name + '(' + this.args.map(function(a) {return a.toString();}).join(',') + ')';
        case 'binop_mult': return this.left.toString() + '*' + this.right.toString();
        case 'binop_div': return this.left.toString() + '/' + this.right.toString();
        case 'binop_add': return this.left.toString() + '+' + this.right.toString();
        case 'binop_sub': return this.left.toString() + '-' + this.right.toString();
        case 'binop_concat': return this.left.toString() + '&' + this.right.toString();
        case 'binop_expon': return this.left.toString() + '^' + this.right.toString();
    }
};

ExpressionNode.prototype.clone = function() {
    switch (this.type) {
        case 'boolean':
        case 'string':
            return new ExpressionNode(this.type, {value: this.value});
        case 'number':
            return new ExpressionNode(this.type, {value: this.value, raw: this.raw});
        case 'identifier':
            return new ExpressionNode(this.type, {value: this.value, pinRow: this.pinRow, pinCol: this.pinCol, raw: this.raw});
        case 'sheetlookup': return new ExpressionNode(this.type, {sheet: this.sheet, content: this.content.clone()});
        case 'range': return new ExpressionNode(this.type, {start: this.start.clone(), end: this.end.clone()});
        case 'function': return new ExpressionNode(this.type, {name: this.name, args: this.args.map(function(arg) {return arg.clone();})});
        case 'binop_mult':
        case 'binop_div':
        case 'binop_add':
        case 'binop_sub':
        case 'binop_concat':
        case 'binop_expon':
            return new ExpressionNode(this.type, {left: this.left.clone(), right: this.right.clone()});
    }
};

ExpressionNode.prototype.adjust = function(deltaRow, deltaCol) {
    this.walk(function(x) {
        if (x.type !== 'identifier') return;
        var pos = getCellPos(x.value);
        var row = pos.row + (x.pinRow ? 0 : deltaRow);
        var col = pos.col + (x.pinCol ? 0 : deltaCol);
        x.value = getCellID(row, col);
        var rematched = TOKEN_CELL_ID.exec(x.value);
        x.raw = (x.pinCol ? '$' : '') + rematched[2] + (x.pinRow ? '$' : '') + rematched[4];
    });
};

function iterateRangeNode(node, cb) {
    var start = getCellPos(node.start.value);
    var end = getCellPos(node.end.value);
    var rowStart = Math.min(start.row, end.row);
    var rowEnd = Math.max(start.row, end.row);
    var colStart = Math.min(start.col, end.col);
    var colEnd = Math.max(start.col, end.col);
    for (var i = rowStart; i <= rowEnd; i++) {
        for (var j = colStart; j <= colEnd; j++) {
            cb(i, j);
        }
    }
}

ExpressionNode.prototype.findCellDependencies = function(cb) {
    this.walk(function(node) {
        if (node.type === 'identifier') {
            cb(node.value);
        } else if (node.type === 'range') {
            iterateRangeNode(node, function(row, col) {
                cb(getCellID(row, col));
            });
        } else if (node.type === 'sheetlookup') {
            return false; // Kills traversal; handled by findSheetDependencies
        }
    });
};

ExpressionNode.prototype.findSheetDependencies = function(cb) {
    this.walk(function(node) {
        if (node.type === 'sheetlookup') {
            node.content.findCellDependencies(function(cellID) {
                cb(node.sheet, cellID);
            });
            return false;
        }
    });
};

ExpressionNode.prototype.run = function(sheet) {
    switch (this.type) {
        case 'boolean':
        case 'number':
        case 'string':
            return this.value;
        case 'identifier': return sheet.getCalculatedValueAtID(this.value);
        case 'sheetlookup': return this.content.run(sheet.getSheet(this.sheet));
        case 'binop_mult': return this.left.run(sheet) * this.right.run(sheet);
        case 'binop_div': return this.left.run(sheet) / this.right.run(sheet);
        case 'binop_add': return parseFloat(this.left.run(sheet)) + parseFloat(this.right.run(sheet));
        case 'binop_sub': return this.left.run(sheet) - this.right.run(sheet);
        case 'binop_concat': return this.left.run(sheet).toString() + this.right.run(sheet).toString();
        case 'binop_expon': return Math.pow(this.left.run(sheet), this.right.run(sheet));
        case 'binop_comp_lt': return parseFloat(this.left.run(sheet)) < parseFloat(this.right.run(sheet));
        case 'binop_comp_lte': return parseFloat(this.left.run(sheet)) <= parseFloat(this.right.run(sheet));
        case 'binop_comp_gt': return parseFloat(this.left.run(sheet)) > parseFloat(this.right.run(sheet));
        case 'binop_comp_gte': return parseFloat(this.left.run(sheet)) >= parseFloat(this.right.run(sheet));
        case 'binop_comp_eq': return this.left.run(sheet) == this.right.run(sheet);
        case 'binop_comp_neq': return this.left.run(sheet) != this.right.run(sheet);
        case 'range':
            var rangeCells = [];
            iterateRangeNode(this, function(row, col) {
                rangeCells.push(parseNumMaybe(sheet.getCalculatedValueAtPos(row, col)));
            });
            return rangeCells;
    }
    if (this.type !== 'function') throw new TypeError('Unknown exression node');
    return execFunc(this.name, this.args);

};

ExpressionNode.prototype.compile = function(sheet) {
    function castNum(x) {
        var compiled = x.compile();
        if (x.compiledReturnType() === 'num') return compiled;
        return 'parseFloat(' + compiled + ')';
    }

    switch (this.type) {
        case 'boolean':
        case 'number':
        case 'string':
            return this.toString();
        case 'identifier': return 'sheet.getCalculatedValueAtID("' + this.value + '")';
        case 'sheetlookup': return '(function(sheet){' + this.content.compile() + '}(sheet.getSheet("' + this.sheet + '")))';
        case 'binop_mult': return '(' + this.left.compile() + '*' + this.right.compile() + ')';
        case 'binop_div': return '(' + this.left.compile() + '/' + this.right.compile() + ')';
        case 'binop_add':
            if (this.right.type === '')
            return '(' + castNum(this.left) + '+' + castNum(this.right) + ')';
        case 'binop_sub': return '(' + this.left.compile() + '-' + this.right.compile() + ')';
        case 'binop_concat': return '((' + this.left.compile() + ').toString()+(' + this.right.compile() + ').toString())';
        case 'binop_expon': return 'Math.pow(' + this.left.compile() + ', ' + this.right.compile() + ')';
        case 'binop_comp_lt': return '(' + castNum(this.left) + ' < ' + castNum(this.right) + ')';
        case 'binop_comp_lte': return '(' + castNum(this.left) + ' <= ' + castNum(this.right) + ')';
        case 'binop_comp_gt': return '(' + castNum(this.left) + ' > ' + castNum(this.right) + ')';
        case 'binop_comp_gte': return '(' + castNum(this.left) + ' >= ' + castNum(this.right) + ')';
        case 'binop_comp_eq': return '(' + this.left.compile() + '==' + this.right.compile() + ')';
        case 'binop_comp_neq': return '(' + this.left.compile() + '!=' + this.right.compile() + ')';

        case 'range':
            var rangeCells = [];
            iterateRangeNode(this, function(row, col) {
                rangeCells.push('parseNumMaybe(sheet.getCalculatedValueAtPos(' + row + ', ' + col + '))');
            });
            return rangeCells.join(',');
        case 'function':
            return 'execFunc("' + this.name + '",[' + this.args.map(function(x) {return x.compile();}).join(',') + '])';
        default:
            throw new TypeError('Cannot compile unknown expression nodes');
    }

};

ExpressionNode.prototype.compiledReturnType = function() {
    switch (this.type) {
        case 'boolean': return 'bool';
        case 'number': return 'num';
        case 'string': return 'str';
        case 'identifier': return 'mixed';
        case 'sheetlookup': return 'mixed';
        case 'binop_mult': return 'num';
        case 'binop_div': return 'num';
        case 'binop_add': return 'num';
        case 'binop_sub': return 'num';
        case 'binop_concat': return 'str';
        case 'binop_expon': return 'num';
        case 'binop_comp_lt': return 'bool';
        case 'binop_comp_lte': return 'bool';
        case 'binop_comp_gt': return 'bool';
        case 'binop_comp_gte': return 'bool';
        case 'binop_comp_eq': return 'bool';
        case 'binop_comp_neq': return 'bool';
        case 'range': return 'arr';
        case 'function': return 'mixed';
    }

    return 'mixed';

};