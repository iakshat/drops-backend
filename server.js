var express = require('express')
var fs = require("fs")
var crypto = require('crypto')
var Type = require('js-binary').Type
var schema = new Type({
    id : 'string',
    username : 'string'
})
var axios = require('axios')
require('dotenv').config()
var hashSecret = process.env.HASH_SECRET;
const fileupload = require('express-fileupload')
var app = express();

app.use(express.json());
app.use(express.urlencoded({extended:true}));
//for cors
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, authorization");
    next();
});
app.use(fileupload())


app.get("/", (req, res) => {
    res.send("Hola Peoples! Server is running ;-)")
})

//Login Page
app.post("/login", (req, res) => {

    var verout = verifyCreds(req.body);
    if(verout === "invalid"){
        res.send({status : "invalid"});
        console.log("failed signin attempt by : ", req.body.username)
    }else if(verout === "inactive"){
        res.send({status : "inactive"});
        console.log("failed signin attempt by : ", req.body.username)
    }else if(verout === "disapproved"){
        res.send({status : "disapproved"});
        console.log("failed signin attempt by disapproved user : ", req.body.username)
    }else{
        var user = getUser(req.body.username);
        var response = createAccessToken(user);
        res.send({status : "success", ...response});
        console.log("signin success by : ", req.body.username)
    }

})

//SignUp Page
app.post("/signup", (req, res) => {

    console.log("user to be added:", req.body, req.files);

    if(getUser(req.body.username)){
        res.send({status : "not available"})
    }
    else{
        var newUser = req.body;
        if(req.body.userType !== "donor"){
            // console.log(req.files)
            // console.log(req.files.certificate)
            var ft = req.files.certificate.name.split(".");
            ft = ft[ft.length-1]
            req.files.certificate.mv(__dirname+"/certificates/"+req.body.username+"."+ft)
            console.log("adding certificate for user "+req.body.username);
            delete newUser["cpassword"];
            newUser["activationStatus"] = 0;
            if(req.body.userType === "bloodbank")
                newUser["inventory"] = {};
        }
        getLatLong(newUser.address)
            .then(geo => {
                newUser["geometry"] = geo;
                if(addUser(newUser) === "success"){
                    res.send({status : "success"})
                }else{
                    res.send({status : "error"})
                }
            })
    }

})

//Profile Page
app.get("/info/user", (req, res) => {

    var d = req.headers.authorization? JSON.parse(req.headers.authorization):{};

    if(verifyAuth(d)){
        var user = getUser(d.username);
        if(user === null){
            res.send({status : "account lost"})
        }else{
            delete user["password"];
            if(user.userType !== "donor")
                delete user["activationStatus"]
            res.send({status : "success", ...user});
            console.log("successful profile query by : ", d.username)
        }
    }
    else{
        res.send({status : "invalid query"})
        console.log("invalid auth for dashboard by ", d.username)
    }

})

//Update Profile
app.post("/update/user", (req, res) => {
    var d = req.headers.authorization? JSON.parse(req.headers.authorization):{};

    if(verifyAuth(d)){
        if(d.username === req.body.username){
            var users = getUsersFromDB();
            var queryUser = users.find(u => {return u.username === d.username});
            var ind = users.indexOf(queryUser);
            queryUser.name = req.body.name;
            queryUser.address = req.body.address;
            if(queryUser.userType === "donor")
                queryUser.bloodGroup = req.body.bloodGroup;
            getLatLong(queryUser.address)
                .then(geo => {
                    queryUser.geometry = geo;
                    users[ind] = queryUser;
                    res.send({status : "success"})
                    putUsersToDB(users);
                    console.log("user updated on request : "+req.body.username)
                })
                .catch(e=>{
                    console.log(e);
                }
                )
        }
        else{
            res.send({status : "invalid request"})
        }
    }
    else{
        res.send({status : "invalid auth"})
    }

})


app.post("/search-blood", (req, res) => {
    var d = req.headers.authorization? JSON.parse(req.headers.authorization):{};
    if(verifyAuth(d)){
        console.log("searchin for ",req.body.bloodGroup, " for user ", d.username);
        var users = getUsersFromDB();
        var bloodBanks = users.filter(user => {return user.userType === "bloodbank"});
        var searchGeometry = users.find(user => {return user.username === d.username}).geometry;
        var validBloodbanks = bloodBanks.filter(bb => {
            return (distanceLatLng(bb.geometry, searchGeometry) < 40 && bb.inventory[req.body.bloodGroup] && bb.inventory[req.body.bloodGroup]!="0");
        })
        validBloodbanks = validBloodbanks.map(bb => {
            return{
                id : bb.id,
                name : bb.name,
                address : bb.address,
                geometry : bb.geometry,
                unitCount : bb.inventory[req.body.bloodGroup]
            }
        })
        res.send({status : "success", bloodGroup : req.body.bloodGroup, searchResults : validBloodbanks})
    }
    else{
        res.send({status : "invalid request"});
        console.log("failed search for blood by ", d.username);
    }
})


app.get("/get-inventory", (req, res) => {
    var d = req.headers.authorization? JSON.parse(req.headers.authorization):{};
    if(verifyAuth(d)){
        var users = getUsersFromDB();
        var inventory = users.find(user => {
            return (user.username === d.username);
        }).inventory;
        if(inventory){
            res.send({status : "success", inventory})
        }
        else{
            res.send({status : "no inventory"})
        }
    }
    else{
        res.send({status : "invalid request"});
    }
})


app.post("/update-inventory", (req, res) => {
    var d = req.headers.authorization? JSON.parse(req.headers.authorization):{};
    if(verifyAuth(d)){
        var users = getUsersFromDB();
        var user = users.find(u => {return u.username === d.username});
        if(user.userType === "bloodbank"){
            users = users.map(usr => {
                if(usr.username === d.username){
                    usr.inventory = {...usr.inventory, ...req.body};
                    return usr;
                }
                return usr;
            })
            console.log(users)
            putUsersToDB(users);
            console.log("Inventory updated for user ", d.username);
            res.send({status : "success"})
        }
        else{
            res.send({status : "invalud query"})
        }
    }
    else{
        res.send({status : "invalid request"});
    }
})


app.get("/notifications", (req, res) => {
    var d = req.headers.authorization? JSON.parse(req.headers.authorization):{};
    if(verifyAuth(d)){
        var user = getUsersFromDB().find(u => {return u.username === d.username});
        // console.log("notif user ",user)
        var requests = getRequestsFromDB().filter(req => {
            return (distanceLatLng(user.geometry, req.geometry) < 40 && req.bloodGroup === user.bloodGroup && req.status === "active")
        });
        if(!requests)
            requests = [];
        res.send({status : "success", notifs : requests})
    }
    else{
        res.send({status : "invalid request"});
    }
})


app.post("/create-donor-request", (req, res) => {
    var d = req.headers.authorization? JSON.parse(req.headers.authorization):{};
    if(verifyAuth(d)){
        var creator = getUsersFromDB().find(u => {return u.username === d.username})
        if(creator.userType !== "donor"){
            var request = {};
            request["geometry"] = creator.geometry;
            request["name"] = creator.name;
            request["username"] = creator.username;
            request["address"] = creator.address;
            request["email"] = creator.email;
            request["bloodGroup"] = req.body.bloodGroup;
            request["status"] = "active";
            var reqs = getRequestsFromDB();
            request["id"] = reqs.length?reqs[reqs.length-1].id+1:0;
            reqs.push(request);
            putRequestsToDB(reqs);
            console.log("created dontaion demand for ",req.body.bloodGroup, " by ", d.username);
            res.send({status : "success"})
        }
        else{
            res.send({status : "invalid query"})
        }
    }
    else{
        res.send({status : "invalid request"});
    }
})


app.post("/delete-donor-request", (req, res) => {
    var d = req.headers.authorization? JSON.parse(req.headers.authorization):{};
    if(verifyAuth(d)){
        var reqs = getRequestsFromDB();
        var change = false;
        reqs = reqs.map(r => {
            if(r.id === req.body.reqId && r.username === d.username){
                change = true;
                r.status = "done";
                return r;
            }
            return r;
        })
        putRequestsToDB(reqs);
        if(change)
            res.send({status : "success"})
        else
            res.send({status : "user mismatch"})
    }
    else{
        res.send({status : "invalid request"});
    }
})


app.get("/requests", (req, res) => {
    var d = req.headers.authorization? JSON.parse(req.headers.authorization):{};
    if(verifyAuth(d)){
        var reqs = getRequestsFromDB();
        res.send({status : "success", requests : reqs})
    }
    else{
        res.send({status : "invalid request"});
    }
})


app.get("/approve-certificate", (req, res) => {
    var d = req.headers.authorization? JSON.parse(req.headers.authorization):{};
    if(verifyAuth(d)){
        if(d.username === process.env.ADMIN){
            var reqUsers = getUsersFromDB().filter(u => {
                return (u.activationStatus === 0)
            })
            res.send({"status" : "success", users: reqUsers})
        }
        else{
            res.send({status : "invalid query"})
        }
    }
    else{
        res.send({status : "invalid request"});
    }
})

app.get("/check-certificate/:username", (req, res) => {
    var filename = fs.readdirSync(__dirname+"/certificates").find(file => {return ( file.split(".")[0] === req.params.username.split(".")[0] )}).split(".")
    var type = filename[filename.length-1];
    res.sendFile(__dirname+"/certificates/"+req.params.username+"."+type);
})

app.post("/approve-certificate", (req, res) => {
    var d = req.headers.authorization? JSON.parse(req.headers.authorization):{};
    if(verifyAuth(d)){
        if(d.username === process.env.ADMIN){
            console.log("body : ",req.body)
            var users = getUsersFromDB()
            var newUsers = users.map(user => {
                if(user.id === req.body.userId){
                    if(req.body.todo === "approve"){
                        console.log("approving user ", user.username)
                        user.activationStatus = 1;
                    }
                    else if(req.body.todo === "reject"){
                        console.log("rejecting user ", user.username)
                        user.activationStatus = 2;
                    }
                }
                return user;
            });
            putUsersToDB(newUsers);
            res.send({"status" : "success"})
        }
        else{
            res.send({status : "invalid query"})
        }
    }
    else{
        res.send({status : "invalid request"});
    }
})


app.listen(process.env.PORT, () => {
    console.log(`server started in port ${process.env.PORT}: http://localhost:${process.env.PORT}/`)
})


//Helping Functions
var verifyAuth = (response) => {

    if(response.isLoggedIn === false)
        return false;

    var data = {
        id : response.id.toString(),
        username : response.username
    };

    var hash = crypto.createHmac('sha256', hashSecret)
                .update(schema.encode(data))
                .digest('hex');

    return hash === response.accessToken;
}

var createAccessToken = (user) => {
    var accessToken = crypto.createHmac('sha256', hashSecret)
                            .update(schema.encode({id : user.id.toString(), username : user.username}))
                            .digest('hex');
    return {accessToken, id:user.id, username:user.username, userType : user.userType}
}

var getUser = (username) => {
    var data = getUsersFromDB();
    return data.find(user => {return user.username === username});
}

var addUser = (user) => {
    var data = getUsersFromDB();
    user.id = data.length?data[data.length-1].id+1:0;
    data.push(user)
    putUsersToDB(data);
}

var verifyCreds = (reqUser) => {
    var users = getUsersFromDB();
    var propUser = users.find(user => {
        return user.username === reqUser.username;
    });
    if(!propUser || propUser.password !== reqUser.password)
        return "invalid";
    else if(propUser.activationStatus === 0)
        return "inactive"
    else if(propUser.activationStatus === 1 || propUser.userType === "donor")
        return "success"
    else
        return "disapproved"
}

var getUsersFromDB = () => {
    return JSON.parse(fs.readFileSync("./db.json")).users
}

var getRequestsFromDB = () => {
    return JSON.parse(fs.readFileSync("./db.json")).requests
}

var putUsersToDB = (allUsers) => {
    var db = JSON.parse(fs.readFileSync("./db.json"));
    db.users = allUsers;
    fs.writeFileSync("./db.json", JSON.stringify(db))
}

var putRequestsToDB = (allReqs) => {
    var db = JSON.parse(fs.readFileSync("./db.json"));
    db.requests = allReqs;
    fs.writeFileSync("./db.json", JSON.stringify(db))
}

var getLatLong = (address) => {
    console.log("finding address ", address)
    return new Promise((resolve, reject) => {
        axios.get("https://api.opencagedata.com/geocode/v1/json?q="+address+"&key="+process.env.API_KEY)
        .then(res => {
            console.log("api response : ", res.data.results[0].geometry)
            resolve(res.data.results[0].geometry);
        })
    })
}

var distanceLatLng = (geo1, geo2) => {

    console.log("calculation distance between", geo1, geo2)

    geo1.lat /= 57.29577951;
    geo1.lng /= 57.29577951;
    geo2.lat /= 57.29577951;
    geo2.lng /= 57.29577951;

    var dist = 1.609344*3963.0*Math.acos( (Math.sin(geo1.lat)*Math.sin(geo2.lat)) + (Math.cos(geo1.lat)*Math.cos(geo2.lat)*Math.cos(geo1.lng-geo2.lng)) );
    geo1.lat *= 57.29577951;
    geo1.lng *= 57.29577951;
    geo2.lat *= 57.29577951;
    geo2.lng *= 57.29577951;
    console.log(dist)
    return dist;
}