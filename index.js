const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.yuxyuxp.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    // Collection instances
    const userCollection = client.db("InventiSync").collection("users");
    const shopCollection = client.db("InventiSync").collection("shops");
    const productCollection = client.db("InventiSync").collection("products");
    const cartCollection = client.db("InventiSync").collection("carts");
    const salesCollection = client.db("InventiSync").collection("sales");
    const subsCollection = client.db("InventiSync").collection("subs");
    const paymentCollection = client.db("InventiSync").collection("payments");

    // JWT token creation endpoint
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // Middleware to verify JWT token
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // Middleware to verify admin role
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden Access" });
      }
      next();
    };

    // verify manager
    const verifyManager = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isManager = user?.role === "manager";
      if (!isManager) {
        return res.status(403).send({ message: "forbidden Access" });
      }
      next();
    };

    // Endpoint to get all users (admin access required)
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // Endpoint to check if user is admin or manager
    app.get("/users/admin-manager/:email", verifyToken, async (req, res) => {
      const requestingUserEmail = req.params.email;
      const authenticatedUserEmail = req.decoded.email;

      if (requestingUserEmail !== authenticatedUserEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: requestingUserEmail };
      const user = await userCollection.findOne(query);

      if (!user) {
        return res.status(404).send({ message: "user not found" });
      }

      if (user.role === "admin" || user.role === "manager") {
        if (user.role === "admin") {
          return res.send({ role: "admin" });
        } else {
          return res.send({ role: "manager" });
        }
      } else {
        return res.status(403).send({ message: "forbidden access" });
      }
    });

    // Endpoint to get individual user data
    app.get("/users/individual/:email", verifyToken, async (req, res) => {
      const { email } = req.params;

      try {
        const query = { email: email }; // Ensure correct field name
        const user = await userCollection.findOne(query);

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json(user);
      } catch (error) {
        res.status(500).send("Internal Server Error");
      }
    });

    // Endpoint to create a new user
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res
          .status(409)
          .json({ message: "User already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // Endpoint to get all shops (admin access required)
    app.get("/shops", verifyToken, verifyAdmin, async (req, res) => {
      const result = await shopCollection.find().toArray();
      res.send(result);
    });

    // Endpoint to create a new shop
    app.post("/shop",verifyToken, async (req, res) => {
      const shop = req.body;
      const query = { name: shop.name };
      const existingShop = await shopCollection.findOne(query);

      if (existingShop) {
        return res
          .status(409)
          .json({ message: "Shop already exists", insertedId: null });
      }

      try {
        const defaultProductLimit = 3;
        const shopWithDefaultLimit = {
          ...shop,
          productLimit: shop.productLimit || defaultProductLimit,
        };

        const shopResult = await shopCollection.insertOne(shopWithDefaultLimit);
        const insertedId = shopResult.insertedId;

        const userQuery = { email: shop.OwnerEmail };
        const userUpdate = {
          $set: {
            shopId: insertedId,
            shopName: shop.name,
            shopLogo: shop.logo,
            role: "manager",
          },
        };

        const userResult = await userCollection.updateOne(
          userQuery,
          userUpdate
        );

        if (userResult.matchedCount === 0) {
          return res
            .status(404)
            .json({ message: "User not found", insertedId: null });
        }

        res.json({ message: "Shop created successfully", insertedId });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Internal server error", insertedId: null });
      }
    });

    // Endpoint to get shops by email
    app.get("/shops/:email?", verifyToken, async (req, res) => {
      const { email } = req.params;
      try {
        const query = email ? { OwnerEmail: email } : {};
        const cursor = shopCollection.findOne(query);
        const result = await cursor;
        res.send(result);
      } catch (error) {
        res.status(500).send("Internal Server Error");
      }
    });

    // Endpoint to get all products
    app.get("/products",verifyToken,verifyAdmin, async (req, res) => {
      const result = await productCollection.find().toArray();
      res.send(result);
    });

    // Endpoint to get a Single Product
    app.get("/products/single/:id",verifyToken, async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };

      try {
        const result = await productCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Endpoint to get all products for specific user
    app.get("/product/specific/email", verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = email ? { OwnerEmail: email } : {};
      const result = await productCollection.find(query).toArray();
      res.send(result);
    });

    // Endpoint to add a new product
    app.post("/products", verifyToken, async (req, res) => {
      const product = req.body;
      const result = await productCollection.insertOne(product);
      res.send(result);
    });

    // Endpoint to update a single product
    app.put("/product/single/update/:id",verifyToken,verifyManager, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateProduct = req.body;
      const product = {
        $set: {
          name: updateProduct.name,
          logo: updateProduct.logo,
          location: updateProduct.location,
          info: updateProduct.info,
          profit: updateProduct.profit,
          cost: updateProduct.cost,
          discount: updateProduct.discount,
          quantity: updateProduct.quantity,
          sellingPrice: updateProduct.sellingPrice,
        },
      };
      const result = await productCollection.updateOne(
        filter,
        product,
        options
      );
      res.send(result);
    });

    // Endpoint to check if a user can add a product
    app.get("/users/can-add-product/:email", verifyToken, async (req, res) => {
      const requestingUserEmail = req.params.email;
      const authenticatedUserEmail = req.decoded.email;

      if (requestingUserEmail !== authenticatedUserEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }

      try {
        const query = { email: requestingUserEmail };
        const user = await userCollection.findOne(query);

        if (!user) {
          return res.status(404).send({ message: "user not found" });
        }

        const productCount = await productCollection.countDocuments({
          OwnerEmail: requestingUserEmail,
        });

        const shop = await shopCollection.findOne({ _id: user.shopId });

        if (!shop) {
          return res.status(404).send({ message: "shop not found" });
        }

        const productLimit = shop.productLimit;

        const canAddProduct = productCount < productLimit;

        res.json({ canAddProduct });
      } catch (error) {
        res.status(500).send("Internal Server Error");
      }
    });

    // Endpoint to delete a product from product collection
    app.delete("/products/delete/:id",verifyToken, verifyManager, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productCollection.deleteOne(query);
      res.send(result);
    });

    // Endpoint to get cart data of specific user
    app.get("/cart/specific/email", verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = email ? { OwnerEmail: email } : {};
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    // check id data exist on cart
    app.get("/carts/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.findOne(query);

      if (result) {
        res.send(result);
      } else {
        res.status(404).send(); // Item not found
      }
    });

    // Endpoint to post item to carts
    app.post("/carts", verifyToken, async (req, res) => {
      const product = req.body;

      // Exclude _id from the update object
      const { _id, ...updateObject } = product;

      const query = { _id: new ObjectId(product._id) };
      const update = { $set: updateObject };
      const options = { upsert: true };

      try {
        const result = await cartCollection.updateOne(query, update, options);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send("Internal Server Error");
      }
    });

    // Endpoint to delete from cart
    app.delete("/cart/delete/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);

      res.send(result);
    });

    // Add to sales collection
    app.post("/sales", verifyToken, async (req, res) => {
      try {
        const saleData = req.body;

        // Insert data into the Sales Collection
        const result = await salesCollection.insertOne(saleData);

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // Increase Sales count in the Product Collection
    app.put(
      "/product/increase-sales-count/:id",
      verifyToken,
      async (req, res) => {
        try {
          const productId = req.params.id;
          // console.log(productId);

          // Increase sales count in the Product Collection
          const result = await productCollection.updateOne(
            { _id: new ObjectId(productId) },
            { $inc: { salesCount: 1 } }
          );

          res.send(result);
        } catch (error) {
          res.status(500).json({ message: "Internal Server Error" });
        }
      }
    );

    // Decrease Quantity in the Product Collection:
    app.put("/product/decrease-quantity/:id", verifyToken, async (req, res) => {
      try {
        const productId = req.params.id;
        // console.log(productId)

        // Decrease quantity in the Product Collection
        const result = await productCollection.updateOne(
          { _id: new ObjectId(productId) },
          { $inc: { quantity: -1 } }
        );
        // console.log(result)
        res.send(result);
      } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // endpoint for sales summary page
    app.get("/sales-summary/:email",verifyToken,verifyManager,  async (req, res) => {
      try {
        const userEmail = req.params.email;

        const soldProduct = await salesCollection.countDocuments({
          OwnerEmail: userEmail,
        });

        const totalSale = await salesCollection
          .find({ OwnerEmail: userEmail })
          .project({ _id: 0, sellingPrice: 1 })
          .toArray()
          .then((docs) =>
            docs.reduce((acc, curr) => acc + curr.sellingPrice, 0)
          )
          .catch((error) => {
            console.error(error);
            return 0;
          });

        const totalInvest = await salesCollection
          .find({ OwnerEmail: userEmail })
          .project({ _id: 0, cost: 1 })
          .toArray()
          .then((docs) => docs.reduce((acc, curr) => acc + curr.cost, 0))
          .catch((error) => {
            console.error(error);
            return 0;
          });

        const totalProfit = await salesCollection
          .find({ OwnerEmail: userEmail })
          .project({ _id: 0, profit: 1 })
          .toArray()
          .then((docs) => docs.reduce((acc, curr) => acc + curr.profit, 0))
          .catch((error) => {
            console.error(error);
            return 0;
          });

        const salesHistory = await salesCollection
          .find({ OwnerEmail: userEmail })
          .sort({ dateStr: -1 })
          .toArray();

        res.json({
          soldProduct,
          totalSale,
          totalInvest,
          totalProfit,
          salesHistory,
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // endpoint to get data from subs indivitual
    app.get("/subscription/:email", async (req, res) => {
      const email = req.query.email;
      const query = { client: email };
      const result = await subsCollection.findOne(query);
      res.send(result);
    });

    // endpoint to post data in subs collection
    app.post("/subscription", async (req, res) => {
      const info = req.body;
      const result = await subsCollection.insertOne(info);
      res.send(result);
    });

    // endpoint to delete data from subs individual
    app.delete("/subscription/delete/:email",verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = { client: email };
      const result = await subsCollection.deleteOne(query);
      // console.log(result)
      res.send(result);
    });

    // payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      // console.log(amount)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // payment database post
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);
      res.send(result);
    });

    // endpoint to update shops product limit
    app.put("/shops/:email", async (req, res) => {
      const email = req.params.email;
      // console.log(email)
      const newProductLimit = req.body.productLimit;
      // console.log(newProductLimit)
      try {
        const result = await shopCollection.updateOne(
          { OwnerEmail: email },
          { $set: { productLimit: newProductLimit } }
        );
        //  console.log(result)
        res.json(result);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // admin sales summury route
    app.get("/sales-view", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const totalIncome = await paymentCollection
          .aggregate([{ $group: { _id: null, total: { $sum: "$price" } } }])
          .toArray();

        const totalProduct = 3;
        const totalSales = await paymentCollection.countDocuments();

        const soldProducts = await paymentCollection
          .find(
            {},
            { _id: 1, name: 1, email: 1, service: 1, price: 1, date: 1 }
          )
          .sort({ date: -1 })
          .toArray();

        res.send({
          totalIncome: totalIncome.length ? totalIncome[0].total : 0,
          totalProduct,
          totalSales,
          soldProducts,
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}

run().catch(console.dir);

// Define a route
app.get("/", (req, res) => {
  res.send("Hello, World!");
});

// Start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
