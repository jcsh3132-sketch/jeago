from flask_sqlalchemy import SQLAlchemy


db = SQLAlchemy()


class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    # Internal unique key. For legacy parents this is usually the visible name.
    # Child rows may use an internal key so the same visible child name can be
    # reused under different parents.
    name = db.Column(db.String(120), unique=True, nullable=False, index=True)
    display_name = db.Column(db.String(80), nullable=True)
    parent_id = db.Column(db.Integer, db.ForeignKey('category.id'), nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=db.func.now(), nullable=False)

    parent = db.relationship('Category', remote_side=[id], backref=db.backref('children', lazy='dynamic'))

    @property
    def label(self):
        return self.display_name or self.name


class Item(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    quantity = db.Column(db.Integer, default=0)
    # Per-model threshold used to decide when stock is considered low.
    low_stock_threshold = db.Column(db.Integer, default=5, nullable=False)
    manager = db.Column(db.String(50), nullable=False)
    # Stores Category.name (internal key) for compatibility with existing DBs.
    category = db.Column(db.String(120), default='')


class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('item.id'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    transaction_type = db.Column(db.String(10), nullable=False)
    manager = db.Column(db.String(50), nullable=False)
    # 출고 시 선택/입력한 거래처명. 기존 최신 DB의 customer_name 컬럼을 그대로 사용합니다.
    customer_name = db.Column(db.String(120), nullable=True)
    date = db.Column(db.DateTime, default=db.func.now())


class Partner(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    contact_person = db.Column(db.String(80), default='')
    phone = db.Column(db.String(50), default='')
    note = db.Column(db.String(255), default='')
    created_at = db.Column(db.DateTime, default=db.func.now())
